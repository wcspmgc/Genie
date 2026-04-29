#!/usr/bin/env python3
"""
Smoke-test: load every supported doc under app/resources/<subdir>, chunk like ingest, optionally embed.

Default folder: app/resources/testdocuments (avoids walking defaultembedder / huge model trees).

Examples (from repo root):

  python app/python_scripts/test_chunk_embed_resources.py
  python app/python_scripts/test_chunk_embed_resources.py --chunk-only
  python app/python_scripts/test_chunk_embed_resources.py --root app/resources/testdocuments
  python app/python_scripts/test_chunk_embed_resources.py --root app/resources --no-skip-heavy-dirs

Embedding uses the same CUDA-only path as the app (see embedding.py). Point at bundled embedder:

  set GENIE_EMBEDDERS_PATHS to app/resources/defaultembedder (script sets this by default if unset).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
_APP = _SCRIPTS.parent
_DEFAULT_SCAN = _APP / "resources" / "testdocuments"
_DEFAULT_EMBEDDERS_ROOT = _APP / "resources" / "defaultembedder"

# same as ingest
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from chunking import chunk_documents  # noqa: E402
from doc_loader import load_document  # noqa: E402
from ingest import ACCEPTED_EXT  # noqa: E402

# skip walking these under resources/ if user passes --root app/resources
_HEAVY_DIR_NAMES = {"defaultembedder", "defaultLLM", "images"}


def collect_files_lite(sources: list[str], *, skip_heavy: bool) -> list[str]:
    """Like ingest.collect_files but can skip known-huge subtrees."""
    out: list[str] = []
    for path in sources:
        path = path.strip()
        if not path:
            continue
        p = Path(path)
        if p.is_file():
            if p.suffix.lower() in ACCEPTED_EXT:
                out.append(str(p.resolve()))
            continue
        if not p.is_dir():
            continue
        root = p.resolve()
        for dirpath, dirnames, filenames in os.walk(root):
            if skip_heavy:
                dirnames[:] = [d for d in dirnames if d not in _HEAVY_DIR_NAMES]
            for name in filenames:
                ext = Path(name).suffix.lower()
                if ext not in ACCEPTED_EXT:
                    continue
                out.append(str(Path(dirpath) / name))
    return sorted(set(out))


def main() -> int:
    ap = argparse.ArgumentParser(description="Test chunk + embed on files under resources/")
    ap.add_argument(
        "--root",
        type=Path,
        default=None,
        help=f"Directory to scan (default: {_DEFAULT_SCAN})",
    )
    ap.add_argument(
        "--chunk-only",
        action="store_true",
        help="Stop after chunking (no torch / CUDA)",
    )
    ap.add_argument(
        "--embedder",
        default="all-MiniLM-L6-v2",
        help="Model name passed to embedding helpers",
    )
    ap.add_argument("--method", default="fixed_256_o10", help="Chunking method (same strings as ingest)")
    ap.add_argument("--chunk-size", type=int, default=512, help="Char chunk size (recursive methods)")
    ap.add_argument("--overlap", type=int, default=51, help="Char overlap (recursive methods)")
    ap.add_argument(
        "--no-skip-heavy-dirs",
        action="store_true",
        help="When scanning, do not skip defaultembedder/defaultLLM/images (careful)",
    )
    args = ap.parse_args()

    scan_root = (args.root or _DEFAULT_SCAN).resolve()
    if not scan_root.is_dir():
        print(f"error: not a directory: {scan_root}", file=sys.stderr)
        return 1

    skip_heavy = not args.no_skip_heavy_dirs
    files = collect_files_lite([str(scan_root)], skip_heavy=skip_heavy)
    if not files:
        print(f"error: no files matching {ACCEPTED_EXT} under {scan_root}", file=sys.stderr)
        return 1

    print(f"scan: {scan_root}", flush=True)
    print(f"files: {len(files)}", flush=True)

    documents = []
    for fp in files:
        loaded = load_document(fp)
        if not loaded:
            print(f"  skip/empty: {fp}", flush=True)
            continue
        for row in loaded:
            documents.append(row)
        nchars = sum(len(row.get("text") or "") for row in loaded)
        print(f"  ok: {fp}  ({nchars} chars)", flush=True)

    if not documents:
        print("error: nothing loaded", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    chunks = chunk_documents(
        [{"text": d["text"], "source": d["source"]} for d in documents],
        args.chunk_size,
        args.overlap,
        args.method,
    )
    t_chunk = time.perf_counter() - t0
    print(f"chunks: {len(chunks)}  (chunking {t_chunk:.2f}s)", flush=True)

    if args.chunk_only:
        return 0

    os.environ.setdefault("GENIE_EMBEDDERS_PATHS", json.dumps([str(_DEFAULT_EMBEDDERS_ROOT.resolve())]))

    from embedding import embed_passages_batched, get_embedder  # noqa: E402

    texts = [t for t, _ in chunks]
    t1 = time.perf_counter()
    mid = get_embedder(args.embedder)
    arr = embed_passages_batched(texts, mid)
    t_emb = time.perf_counter() - t1
    print(f"embed: shape={arr.shape} dtype={arr.dtype}  ({t_emb:.2f}s)", flush=True)
    print(f"model resolved: {mid}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
