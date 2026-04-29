"""
Quick probe: read training/context length from a GGUF without loading weights.

Primary path: gguf.GGUFReader (mmap metadata only).
Optional: llama-cpp-python with n_ctx=0 uses n_ctx_train() from file — heavier (loads model struct).

  python test_gguf_context.py path/to/model.gguf
  python test_gguf_context.py path/to/model.gguf --llama

needs: pip install gguf
optional --llama: llama-cpp-python (same stack as Genie chat)
"""
from __future__ import annotations

import argparse
import sys


def context_keys_from_gguf_reader(path: str) -> list[tuple[str, int]]:
    try:
        from gguf import GGUFReader
    except ImportError:
        print("install gguf: pip install gguf", file=sys.stderr)
        raise SystemExit(2)

    reader = GGUFReader(path)
    out: list[tuple[str, int]] = []
    for name, field in reader.fields.items():
        if not name.endswith(".context_length"):
            continue
        try:
            raw = field.contents()
            out.append((name, int(raw)))
        except (TypeError, ValueError) as e:
            print(f"skip {name}: {e}", file=sys.stderr)
    out.sort(key=lambda x: x[0])
    return out


def context_via_llama_cpp(path: str) -> None:
    try:
        from llama_cpp import Llama
    except ImportError:
        print("no llama_cpp, skip --llama", file=sys.stderr)
        return

    print("loading model header via llama-cpp (may take a few seconds)…", file=sys.stderr)
    lm = Llama(
        model_path=path,
        n_ctx=0,
        n_gpu_layers=0,
        verbose=False,
    )
    train = lm._model.n_ctx_train()  # noqa: SLF001 — public enough for probing
    print(f"llama_cpp n_ctx_train(): {train}")
    meta = getattr(lm, "metadata", None) or {}
    for k in sorted(meta):
        if "context" in k.lower():
            print(f"  metadata[{k}] = {meta[k]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Print context_length from GGUF metadata")
    ap.add_argument("gguf", help="path to .gguf")
    ap.add_argument("--llama", action="store_true", help="also load with llama-cpp and print n_ctx_train()")
    args = ap.parse_args()

    pairs = context_keys_from_gguf_reader(args.gguf)
    if not pairs:
        print("no *.context_length keys found; arch-specific keys often look like llama.context_length, …", file=sys.stderr)
        print("(dumping keys containing 'context':)", file=sys.stderr)
        from gguf import GGUFReader

        r = GGUFReader(args.gguf)
        for name in r.fields:
            if "context" in name.lower():
                f = r.fields[name]
                try:
                    print(f"  {name} = {f.contents()}", file=sys.stderr)
                except Exception as e:
                    print(f"  {name} (could not read: {e})", file=sys.stderr)
        return 1

    for k, v in pairs:
        print(f"{k}: {v}")

    if args.llama:
        print()
        context_via_llama_cpp(args.gguf)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
