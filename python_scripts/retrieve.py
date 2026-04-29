"""
Persistent retriever: load HF embedding model + LanceDB on startup. Stdin loop:
{ "command": "retrieve", "query", "tableName", "k", "embedder?", "requestId?" }
-> embed query, search table, return plaintext snippets.

Log line goes to stderr ([Genie/retrieve]) so Electron shows it. stdout stays one JSON object per line.

Bad PDF / extractors sometimes store lone UTF-16 surrogate code units in Python str. Those cannot be
encoded cleanly for IPC, and some docs also contain stray C0/C1 control chars that upset Windows codepages.
We strip them from query + snippet text before logging/printing JSON.
"""
from __future__ import annotations

import sys
import json
import os
import traceback
from pathlib import Path

# when electron spawns us, cwd can be anywhere. make sibling imports reliable.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

# Node sets LANCEDB_URI when spawning (userData/lancedb)
# Supports:
# - semantic (default): vector search
# - bm25: Lance FTS search (text)
# - hybrid: vector + FTS + RRF rerank

# lance default vector index trains PQ; needs enough rows or you get:
# "Not enough rows to train PQ. Requires 256 rows but only N available"
_MIN_ROWS_FOR_VECTOR_PQ_INDEX = 256
_reranker_cache = {}


def _ret_log(msg: str) -> None:
    print(f"[Genie/retrieve] {msg}", file=sys.stderr, flush=True)


def _count_surrogate_units(s: str) -> int:
    return sum(1 for c in s if 0xD800 <= ord(c) <= 0xDFFF)


def _strip_surrogates(s: str) -> str:
    """U+D800..U+DFFF are not Unicode scalar values; UTF-8 IPC blows up on them."""
    if not s:
        return s
    return "".join(c for c in s if not (0xD800 <= ord(c) <= 0xDFFF))


def _strip_bad_controls(s: str) -> str:
    """keep normal whitespace, drop weird control chars from flaky extractors / rtf."""
    if not s:
        return s
    out = []
    for c in s:
        o = ord(c)
        if c in ("\n", "\r", "\t"):
            out.append(c)
            continue
        if 0x00 <= o <= 0x1F:
            continue
        if 0x7F <= o <= 0x9F:
            continue
        out.append(c)
    return "".join(out)


def _sanitize_text(s: str) -> str:
    return _strip_bad_controls(_strip_surrogates(s))


def _try_local_reranker_snapshot(leaf: str) -> str | None:
    raw = os.environ.get("GENIE_RERANKERS_PATHS")
    if not raw or not leaf:
        return None
    try:
        roots = [Path(p) for p in json.loads(raw) if p]
    except json.JSONDecodeError:
        return None
    leaf = leaf.split("/")[-1].strip()
    if not leaf:
        return None
    for r in roots:
        cand = (r / leaf).resolve()
        if cand.is_dir():
            return str(cand)
    return None


def _normalize_reranker_model(name: str | None) -> str | None:
    if name is None or not str(name).strip():
        return None
    name = str(name).strip()
    expanded = os.path.expanduser(name)
    if os.path.isdir(expanded):
        return expanded
    local = _try_local_reranker_snapshot(name)
    if local:
        return local
    return name


def _get_reranker(model_name: str | None):
    mid = _normalize_reranker_model(model_name)
    if not mid:
        return None, None
    cached = _reranker_cache.get(mid)
    if cached is not None:
        return cached, mid
    from sentence_transformers import CrossEncoder
    reranker = CrossEncoder(mid, device="cpu")
    _reranker_cache[mid] = reranker
    return reranker, mid


def _rerank_snippets(query: str, snippets: list[dict], model_name: str | None, top_k: int):
    reranker, resolved_name = _get_reranker(model_name)
    if reranker is None or not snippets:
        return snippets, resolved_name
    pairs = [(query, s.get("text", "")) for s in snippets]
    scores = reranker.predict(pairs, batch_size=min(16, max(1, len(pairs))), show_progress_bar=False)
    rescored = []
    for s, score in zip(snippets, scores):
        out = dict(s)
        out["score"] = float(score)
        rescored.append(out)
    rescored.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    if top_k > 0:
        rescored = rescored[:top_k]
    return rescored, resolved_name


def _list_index_configs(table):
    try:
        return list(table.list_indices())
    except Exception:
        return []


def _has_vector_index(table, vector_col="vector"):
    for ic in _list_index_configs(table):
        t = getattr(ic, "index_type", "") or ""
        cols = getattr(ic, "columns", None) or []
        if t == "FTS":
            continue
        if vector_col in cols:
            return True
    return False


def _has_fts_index(table, field):
    for ic in _list_index_configs(table):
        if getattr(ic, "index_type", "") == "FTS":
            cols = getattr(ic, "columns", None) or []
            if field in cols:
                return True
    return False


def _table_row_count(table):
    try:
        return int(table.count_rows())
    except Exception:
        return None


def _ensure_vector_index(table, metric="cosine"):
    if _has_vector_index(table):
        return
    n = _table_row_count(table)
    if n is None or n < _MIN_ROWS_FOR_VECTOR_PQ_INDEX:
        # flat scan — fine for tiny corpora (e.g. 1 chunk)
        return
    table.create_index(metric=metric, vector_column_name="vector", replace=True)


def _ensure_fts_index(table, field):
    if _has_fts_index(table, field):
        return
    table.create_fts_index(field, replace=True)


def _infer_fts_cols(table):
    names = set(getattr(table.schema, "names", []) or [])
    cols = []
    if "text" in names:
        cols.append("text")
    if "desc" in names:
        cols.append("desc")
    return cols


def _normalize_method(s):
    t = (s or "").strip().lower()
    if not t:
        return "semantic"
    if t in ("semantic", "vector", "dense"):
        return "semantic"
    if t in ("bm25", "fts"):
        return "bm25"
    if t in ("hybrid",):
        return "hybrid"
    return "semantic"


def main():
    lancedb_uri = os.environ.get("LANCEDB_URI")
    if not lancedb_uri:
        print(json.dumps({"status": "error", "message": "LANCEDB_URI not set"}), flush=True)
        return

    import lancedb
    from lancedb.rerankers import RRFReranker

    from embedding import embed_one, get_embedder

    get_embedder()
    db = lancedb.connect(lancedb_uri)

    print(json.dumps({"status": "ready", "message": "retriever ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            cmd = payload.get("command")
            request_id = payload.get("requestId")
            if cmd != "retrieve":
                out = {"status": "error", "message": f"Unknown command: {cmd}"}
                if request_id is not None:
                    out["requestId"] = request_id
                print(json.dumps(out), flush=True)
                continue

            query_raw = payload.get("query", "")
            if not isinstance(query_raw, str):
                query_raw = str(query_raw)
            q_sur = _count_surrogate_units(query_raw)
            query = _sanitize_text(query_raw)
            table_name = payload.get("tableName")
            k = int(payload.get("k", 5))
            method = _normalize_method(payload.get("method"))
            embedder_name = payload.get("embedder")
            reranker_name = payload.get("rerankerModel") or payload.get("reranker")
            reranker_top_k = int(payload.get("rerankerTopK") or payload.get("rerankTopK") or k)
            vector_metric = (payload.get("vectorMetric") or payload.get("vector_metric") or "cosine").strip().lower()

            if not table_name:
                out = {"status": "error", "message": "tableName required"}
                if request_id is not None:
                    out["requestId"] = request_id
                print(json.dumps(out), flush=True)
                continue

            _ret_log(
                f"request table={table_name!r} k={k} method={method} metric={vector_metric} "
                f"embedder={embedder_name!r} reranker={reranker_name!r} reranker_top_k={reranker_top_k} "
                f"query_chars={len(query_raw)} query_stripped_surrogates={q_sur}"
            )

            table = db.open_table(table_name)
            fts_cols = _infer_fts_cols(table)
            n_rows = _table_row_count(table)
            _ret_log(f"opened_table row_count={n_rows} fts_cols={fts_cols}")

            # prepare indexes lazily so fresh corpora work right away
            if method in ("semantic", "hybrid"):
                _ensure_vector_index(table, metric=vector_metric)
            if method in ("bm25", "hybrid"):
                if not fts_cols:
                    out = {"status": "error", "message": "No FTS columns available on this table"}
                    if request_id is not None:
                        out["requestId"] = request_id
                    print(json.dumps(out), flush=True)
                    continue
                for c in fts_cols:
                    _ensure_fts_index(table, c)

            if method == "bm25":
                _ret_log("search bm25 FTS")
                hits = table.search(query, query_type="fts", fts_columns=fts_cols).limit(k).to_list()
            else:
                _ret_log("embed_query then vector search")
                query_vec = embed_one(query, model_name=embedder_name).tolist()
                if method == "hybrid":
                    _ret_log("hybrid vector+fts+RRF")
                    hits = (
                        table.search(
                            query_type="hybrid",
                            vector_column_name="vector",
                            fts_columns=fts_cols,
                        )
                        .vector(query_vec)
                        .text(query)
                        .distance_type(vector_metric)
                        .rerank(RRFReranker(), normalize="rank")
                        .limit(k)
                        .to_list()
                    )
                else:
                    hits = (
                        table.search(query_vec, vector_column_name="vector")
                        .distance_type(vector_metric)
                        .limit(k)
                        .to_list()
                    )

            snippets = []
            for hi, h in enumerate(hits):
                raw_text = h.get("text", "")
                if not isinstance(raw_text, str):
                    raw_text = str(raw_text) if raw_text is not None else ""
                t_sur = _count_surrogate_units(raw_text)
                text = _sanitize_text(raw_text)
                if method == "bm25":
                    score = float(h.get("_score") or 0.0)
                else:
                    dist = h.get("_distance")
                    score = float(-dist) if dist is not None else 0.0
                snippets.append({"text": text, "score": score})
                if hi < 3:
                    _ret_log(
                        f"hit[{hi}] score={score:.4f} text_len={len(raw_text)} stripped_surrogates={t_sur!r}"
                    )

            reranker_resolved = None
            if reranker_name and snippets:
                _ret_log(f"rerank start candidates={len(snippets)} top_k={reranker_top_k}")
                snippets, reranker_resolved = _rerank_snippets(query, snippets, reranker_name, reranker_top_k)
                _ret_log(f"rerank done candidates={len(snippets)} resolved={reranker_resolved!r}")

            out = {"status": "success", "snippets": snippets, "method": method, "vectorMetric": vector_metric}
            if reranker_resolved:
                out["rerankerModel"] = reranker_resolved
                out["reranked"] = True
            if request_id is not None:
                out["requestId"] = request_id
            reply = json.dumps(out, ensure_ascii=True)
            _ret_log(f"success snippets={len(snippets)} reply_json_chars={len(reply)}")
            print(reply, flush=True)
        except Exception as e:
            _ret_log(f"FAILED {e!r}")
            traceback.print_exc(file=sys.stderr)
            out = {"status": "error", "message": str(e)}
            if "request_id" in locals() and request_id is not None:
                out["requestId"] = request_id
            print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
