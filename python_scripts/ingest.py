"""
Ephemeral ingest: one job from stdin. Job = sources (paths), tableName, settings.
Expand paths (file or dir via os.walk), load, chunk, embed, write plaintext to LanceDB table; exit.
"""
from __future__ import annotations

import sys
import json
import os
from pathlib import Path

# when electron spawns us, cwd can be anywhere. make sibling imports reliable.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

ACCEPTED_EXT = (".txt", ".md", ".html", ".htm", ".pdf", ".docx", ".rtf")


def emit_progress(phase, percent, message=""):
    """json line for electron; phase is chunking | embedding — each phase uses its own 0–100% bar"""
    pct = max(0, min(100, int(round(percent))))
    print(
        json.dumps({"status": "progress", "phase": phase, "percent": pct, "message": message or ""}),
        flush=True,
    )


def estimate_tokens(text: str) -> int:
    return int((len(str(text or "")) + 3) // 4)


def collect_files(sources):
    """Expand sources (file or dir paths) to a flat list of file paths."""
    files = []
    for path in sources:
        path = path.strip()
        if not path:
            continue
        if os.path.isfile(path):
            if os.path.splitext(path)[1].lower() in ACCEPTED_EXT:
                files.append(path)
        elif os.path.isdir(path):
            for root, _, names in os.walk(path):
                for name in names:
                    ext = os.path.splitext(name)[1].lower()
                    if ext in ACCEPTED_EXT:
                        files.append(os.path.join(root, name))
    return files


def main():
    lancedb_uri = os.environ.get("LANCEDB_URI")
    if not lancedb_uri:
        print(json.dumps({"status": "error", "message": "LANCEDB_URI not set"}), flush=True)
        return 1

    line = sys.stdin.readline()
    if not line:
        print(json.dumps({"status": "error", "message": "No job payload"}), flush=True)
        return 1

    try:
        job = json.loads(line.strip())
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "message": str(e)}), flush=True)
        return 1

    sources = job.get("sources", [])
    table_name = job.get("tableName")
    settings = job.get("settings", {})
    chunk_size = int(settings.get("chunkSize", 512))
    overlap = int(settings.get("overlap", 50))
    embedder_name = settings.get("embedder", "all-MiniLM-L6-v2")
    method = settings.get("method", "fixed_256_o10")

    if not table_name:
        print(json.dumps({"status": "error", "message": "tableName required"}), flush=True)
        return 1

    # paths only (sources can be list of path strings)
    paths = []
    for s in sources:
        if isinstance(s, dict):
            paths.append(s.get("path", ""))
        else:
            paths.append(str(s))

    files = collect_files(paths)
    if not files:
        print(json.dumps({"status": "error", "message": "No valid files found in sources"}), flush=True)
        return 1

    emit_progress("chunking", 0, f"{len(files)} file(s)")

    from collections import defaultdict

    import numpy as np
    from doc_loader import load_document
    from chunking import chunk_documents
    from embedding import embed_passages_batched, get_embedder
    from lancedb_layer import connect, add_to_table

    documents = []
    n = len(files)
    for i, fp in enumerate(files):
        documents.extend(load_document(fp))
        # chunking bar: 0–100, mostly while reading files
        emit_progress("chunking", max(1, int((i + 1) / max(n, 1) * 70)), f"reading {i + 1}/{n}")

    if not documents:
        print(json.dumps({"status": "error", "message": "No content extracted from files"}), flush=True)
        return 1

    emit_progress("chunking", 78, "splitting text")
    chunks_tuples = chunk_documents(
        [{"text": d["text"], "source": d["source"]} for d in documents],
        chunk_size,
        overlap,
        method
    )
    if not chunks_tuples:
        print(json.dumps({"status": "error", "message": "No chunks produced"}), flush=True)
        return 1

    texts = [t[0] for t in chunks_tuples]
    sources_list = [t[1] for t in chunks_tuples]
    approx_tokens = sum(estimate_tokens(t) for t in texts)

    emit_progress("chunking", 100, f"{len(chunks_tuples)} chunks")

    # second full bar: one step per source file (20 files -> 5% steps; 3 files -> ~33% steps)
    by_src = defaultdict(list)
    for i, src in enumerate(sources_list):
        by_src[str(src)].append(i)
    ordered_sources = sorted(by_src.keys(), key=str)
    n_src_files = len(ordered_sources)
    if n_src_files < 1:
        print(json.dumps({"status": "error", "message": "No chunk sources"}), flush=True)
        return 1

    emit_progress("embedding", 0, f"{n_src_files} file(s), {len(texts)} chunks")
    mid = get_embedder(embedder_name)
    vectors = None
    for doc_i, src in enumerate(ordered_sources):
        idxs = by_src[src]
        batch_texts = [texts[i] for i in idxs]
        part = embed_passages_batched(batch_texts, mid)
        if vectors is None:
            vectors = np.zeros((len(texts), part.shape[1]), dtype=np.float32)
        vectors[idxs] = part
        pct = int(100 * (doc_i + 1) / n_src_files)
        emit_progress("embedding", pct, f"{doc_i + 1}/{n_src_files} files")

    db = connect(lancedb_uri)
    emit_progress("embedding", 100, f"saving {table_name}")
    add_to_table(db, table_name, vectors.tolist(), texts, sources=sources_list)

    print(json.dumps({"status": "success", "chunks": len(texts), "approxTokens": approx_tokens}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
