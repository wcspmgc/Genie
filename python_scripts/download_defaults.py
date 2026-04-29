# stdin: one json object — models_dir, embedders_dir, skip_llm, skip_embedder,
# llm_repo, llm_file (one gguf via hf_hub_download), embedder_repo (full repo snapshot_download), embedder_folder
# stdout: json lines type=progress | type=done (same idea as ingest)
import json
import sys
from pathlib import Path


def emit(obj):
    print(json.dumps(obj), flush=True)


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        emit({"type": "done", "ok": False, "error": "no config on stdin"})
        return
    cfg = json.loads(raw)
    models_dir = Path(cfg["models_dir"])
    embedders_dir = Path(cfg["embedders_dir"])
    try:
        from huggingface_hub import hf_hub_download, snapshot_download
    except ImportError as e:
        emit({"type": "done", "ok": False, "error": f"huggingface_hub not installed ({e}). pip install huggingface_hub in app python_env."})
        return
    ran = False
    try:
        if not cfg.get("skip_llm"):
            ran = True
            emit({"type": "progress", "phase": "llm", "percent": 10, "message": "Downloading LLM (HF)…"})
            models_dir.mkdir(parents=True, exist_ok=True)
            hf_hub_download(
                repo_id=cfg["llm_repo"],
                filename=cfg["llm_file"],
                local_dir=str(models_dir),
            )
            emit({"type": "progress", "phase": "llm", "percent": 45, "message": "LLM saved"})
        if not cfg.get("skip_embedder"):
            ran = True
            emit({"type": "progress", "phase": "embedder", "percent": 50, "message": "Downloading MiniLM embedder…"})
            dest = embedders_dir / cfg["embedder_folder"]
            dest.mkdir(parents=True, exist_ok=True)
            snapshot_download(
                repo_id=cfg["embedder_repo"],
                local_dir=str(dest),
            )
            emit({"type": "progress", "phase": "embedder", "percent": 95, "message": "Embedder saved"})
        if ran:
            emit({"type": "progress", "phase": "done", "percent": 100, "message": "Finished"})
        emit({"type": "done", "ok": True})
    except Exception as e:
        emit({"type": "done", "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
