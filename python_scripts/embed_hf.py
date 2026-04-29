"""
Minimal bundled SentenceTransformer embed helpers for packaged Genie.

This is copied in spirit from `ml/embed_hf.py`, but trimmed to only what the app's
ingest/retrieve path actually uses: `embed_query` and `embed_passages`.
"""
from __future__ import annotations

from contextlib import contextmanager


_model = None
_model_key: tuple[str, str] | None = None


@contextmanager
def model_load_guard():
    """remote code sometimes lists flash_attn even though sdpa is enough."""
    try:
        import flash_attn  # noqa: F401
        yield
        return
    except ImportError:
        pass
    try:
        from unittest.mock import patch
        from transformers.dynamic_module_utils import get_imports as _orig_get_imports
    except ImportError:
        yield
        return

    def _no_flash(filename):
        return [x for x in _orig_get_imports(filename) if "flash_attn" not in x and "flash_attn_2" not in x]

    with patch("transformers.dynamic_module_utils.get_imports", _no_flash):
        yield


def _trust_remote_code(model_id: str) -> bool:
    s = str(model_id).replace("\\", "/").lower()
    return any(
        k in s
        for k in (
            "baai",
            "bge",
            "jina",
            "internlm",
            "gemma",
            "embeddinggemma",
        )
    )


def _pick_device(explicit: str | None) -> str:
    if explicit:
        return explicit
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _st_load_kwargs(model_id: str, device: str, trust_remote_code: bool | None = None) -> dict:
    tc = trust_remote_code if trust_remote_code is not None else _trust_remote_code(model_id)
    kw: dict = {"device": device, "trust_remote_code": tc}
    if not tc:
        return kw
    kw["model_kwargs"] = {"attn_implementation": "sdpa"}
    kw["tokenizer_kwargs"] = {"padding_side": "left"}
    return kw


def _ensure_model(model_id: str, device: str):
    global _model, _model_key
    key = (model_id, device)
    if _model is not None and _model_key == key:
        return _model

    from sentence_transformers import SentenceTransformer

    st_kw = _st_load_kwargs(model_id, device, trust_remote_code=None)
    with model_load_guard():
        try:
            _model = SentenceTransformer(model_id, **st_kw)
        except (TypeError, ValueError, RuntimeError):
            st_kw.pop("model_kwargs", None)
            _model = SentenceTransformer(model_id, **st_kw)
    _model_key = key
    return _model


def _encode(model, texts, *, for_query: bool, normalize_embeddings: bool, convert_to_numpy: bool):
    prompts = getattr(model, "prompts", None)
    kw = {
        "normalize_embeddings": normalize_embeddings,
        "convert_to_numpy": convert_to_numpy,
    }
    if for_query and isinstance(prompts, dict) and "query" in prompts:
        kw["prompt_name"] = "query"
    return model.encode(texts, **kw)


def embed_query(
    query: str,
    model_id_or_path: str | None = None,
    *,
    device: str | None = None,
    normalize_embeddings: bool = True,
) -> list[float]:
    mid = model_id_or_path or "sentence-transformers/all-MiniLM-L6-v2"
    dev = _pick_device(device)
    model = _ensure_model(mid, dev)
    vec = _encode(
        model,
        query,
        for_query=True,
        normalize_embeddings=normalize_embeddings,
        convert_to_numpy=True,
    )
    return vec.tolist()


def embed_passages(
    texts: list[str],
    model_id_or_path: str | None = None,
    *,
    device: str | None = None,
    normalize_embeddings: bool = True,
):
    mid = model_id_or_path or "sentence-transformers/all-MiniLM-L6-v2"
    dev = _pick_device(device)
    model = _ensure_model(mid, dev)
    return _encode(
        model,
        texts,
        for_query=False,
        normalize_embeddings=normalize_embeddings,
        convert_to_numpy=True,
    )
