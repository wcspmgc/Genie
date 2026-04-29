"""
HF embeddings via bundled `embed_hf.py`.

Same stance as ml/embed_pass._require_cuda_for_embed: real embed runs are CUDA-only.
Log to stderr only so ingest stdout stays pure json lines for Electron.

Resolves model names: full hub ids (Alibaba-NLP/...), sentence-transformers/..., local dirs,
or bare names like all-MiniLM-L6-v2 -> sentence-transformers/...

Electron sets GENIE_EMBEDDERS_PATHS=json array: [<userData>/embedders, app/resources/embedders] — first match wins.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

from embed_hf import embed_passages, embed_query

_warmed: str | None = None
_cuda_logged = False


def _require_cuda():
    """no silent cpu — matches ml2 embed path expectations."""
    global _cuda_logged
    try:
        import torch
    except ImportError as e:
        raise RuntimeError("embedding needs torch installed") from e
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Genie embedding requires CUDA (torch.cuda.is_available() is False). "
            "Install a CUDA PyTorch wheel + NVIDIA drivers; CPU is not supported."
        )
    if not _cuda_logged:
        tv = getattr(torch, "__version__", "?")
        print(
            f"[Genie/embedding] CUDA only | gpu={torch.cuda.get_device_name(0)!r} | torch={tv}",
            file=sys.stderr,
            flush=True,
        )
        _cuda_logged = True


def _embed_encode_batch_size():
    try:
        return max(8, int(os.environ.get("GENIE_EMBED_BATCH_SIZE", "128")))
    except (TypeError, ValueError):
        return 128


def embed_passages_batched(texts: list, model_id_or_path: str) -> np.ndarray:
    """cuda encode in sub-batches so one doc with many chunks doesn't oom."""
    _require_cuda()
    if not texts:
        return np.zeros((0, 0), dtype=np.float32)
    bs = _embed_encode_batch_size()
    parts = []
    for i in range(0, len(texts), bs):
        chunk = texts[i : i + bs]
        arr = embed_passages(
            chunk,
            model_id_or_path=model_id_or_path,
            device="cuda",
        )
        parts.append(arr)
    return np.vstack(parts)


def _try_local_embedder_snapshot(leaf: str) -> str | None:
    raw = os.environ.get("GENIE_EMBEDDERS_PATHS")
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


def _normalize_embedding_model(name: str | None) -> str:
    if name is None or not str(name).strip():
        name = os.environ.get("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    else:
        name = str(name).strip()
    expanded = os.path.expanduser(name)
    if os.path.isdir(expanded):
        return expanded

    if "/" not in name:
        local = _try_local_embedder_snapshot(name)
        if local:
            return local
        return f"sentence-transformers/{name}"

    if name.startswith("sentence-transformers/"):
        short = name[len("sentence-transformers/") :]
        local = _try_local_embedder_snapshot(short)
        if local:
            return local
        return name

    local = _try_local_embedder_snapshot(name.split("/")[-1])
    if local:
        return local
    return name


def get_embedder(model_name=None):
    """preload weights into embed_hf cache; returns resolved model id/path string."""
    global _warmed
    _require_cuda()
    mid = _normalize_embedding_model(model_name)
    if _warmed != mid:
        embed_query(" ", model_id_or_path=mid, device="cuda")
        _warmed = mid
    return mid


def embed_texts(texts, model_name=None):
    """passage / chunk embeddings (no query prompt)."""
    mid = _normalize_embedding_model(model_name)
    get_embedder(model_name)
    return embed_passages_batched(list(texts), mid)


def embed_one(text, model_name=None):
    """search query embedding (uses query prompt when model supports it)."""
    _require_cuda()
    mid = _normalize_embedding_model(model_name)
    return np.asarray(embed_query(text, model_id_or_path=mid, device="cuda"), dtype=np.float32)
