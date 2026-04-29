"""
Chat process: LLM only. Load/unload GGUF via llama-cpp-python, stdin loop for
load_model, unload_model, chat; stream tokens. Models path comes from Node (models_dir in load_model args).

Chat uses create_chat_completion so GGUF chat_template applies (no hand-rolled ChatML).

Logging: everything llama/chat goes to stderr with [Genie/chat] so Electron shows it (see python.js).
Set GENIE_CHAT_DEBUG=0 to trim stdin/command logs; GENIE_LLAMA_VERBOSE=0 silences llama.cpp native spam.
GENIE_CHAT_PROMPT_MAX=2000000 caps huge prompts in logs (0 = unlimited).
"""
import sys
import json
import os
import re
import ctypes
import traceback
from pathlib import Path


def prepare_llama_runtime():
    if sys.platform != "win32":
        return None

    exe_dir = Path(sys.executable).resolve().parent

    llama_lib_dir = None
    for site_lib in (
        exe_dir / "Lib" / "site-packages" / "llama_cpp" / "lib",
        exe_dir.parent / "Lib" / "site-packages" / "llama_cpp" / "lib",
    ):
        if site_lib.is_dir():
            llama_lib_dir = site_lib
            break

    if llama_lib_dir is None:
        raise RuntimeError("Could not find llama_cpp/lib directory")

    cuda_bin = None
    for p in [
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2\bin",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1\bin",
    ]:
        if os.path.isdir(p):
            cuda_bin = p
            break

    print(
        f"[Genie/chat] prepare_llama_runtime: llama_lib_dir={llama_lib_dir} cuda_bin={cuda_bin!r}",
        file=sys.stderr,
        flush=True,
    )
    os.add_dll_directory(str(llama_lib_dir))
    if cuda_bin:
        os.add_dll_directory(cuda_bin)

    # also prepend PATH for stubborn Windows loader cases
    extra = [str(llama_lib_dir)]
    if cuda_bin:
        extra.append(cuda_bin)
    os.environ["PATH"] = os.pathsep.join(extra + [os.environ.get("PATH", "")])

    # preload native chain explicitly
    for name in ["ggml-base.dll", "ggml.dll", "ggml-cpu.dll", "ggml-cuda.dll", "llama.dll"]:
        ctypes.CDLL(str(llama_lib_dir / name))

    return llama_lib_dir


Llama = None
LLAMA_IMPORT_ERROR = None

llm = None
current_model_name = None

THOUGHT_BLOCK = re.compile(
    r'<(?:think|thought|reasoning|step)>([\s\S]*?)<\/(?:think|thought|reasoning|step)>|\[REASONING\]([\s\S]*?)\[\/REASONING\]',
    re.IGNORECASE
)


def is_inside_thought(buf):
    open_pat = re.compile(r'<(?:think|thought|reasoning|step)>|\[REASONING\]', re.I)
    close_pat = re.compile(r'</(?:think|thought|reasoning|step)>|\[/REASONING\]', re.I)
    for m in close_pat.finditer(buf):
        if m.end() == len(buf):
            return False
    last_open = last_close = None
    for m in open_pat.finditer(buf):
        last_open = m
    for m in close_pat.finditer(buf):
        last_close = m
    if last_open is None:
        return False
    if last_close is None:
        return True
    return last_open.end() > last_close.end()


def log(msg):
    print(json.dumps({"status": "debug", "message": str(msg)}), flush=True)


def _chat_debug():
    return os.environ.get("GENIE_CHAT_DEBUG", "1").strip().lower() not in ("0", "false", "no", "off")


def _chat_stderr(*parts, sep=" "):
    """Always-on diagnostic sink for terminal (Electron forwards stderr)."""
    try:
        print("[Genie/chat]", *parts, file=sys.stderr, sep=sep, flush=True)
    except Exception:
        pass


def _strip_surrogates(s: str) -> str:
    # pdf / mojibake sometimes yields lone UTF-16 units in str; they arent UTF-8 encodable for IPC json
    if not s:
        return s
    return "".join(c for c in s if not (0xD800 <= ord(c) <= 0xDFFF))


def _ipc_log_incoming(cmd, args, raw_line_len):
    """Every Electron JSON line decoded — always stderr (not gated by GENIE_CHAT_DEBUG)."""
    _chat_stderr(f"IPC stdin <- Electron: command={cmd!r} raw_json_chars={raw_line_len}")
    _chat_stderr(_summarize_command_args(cmd, args))


def _ipc_log_outgoing(obj):
    """Single-line stdout contract + mirror on stderr for terminal logs."""
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception as e:
        s = json.dumps({"status": "error", "message": f"result json failed: {e}"})
    _chat_stderr(f"IPC stdout -> Electron: len={len(s)}")
    _chat_stderr(s)


def _prompt_log_cap():
    try:
        n = int(os.environ.get("GENIE_CHAT_PROMPT_MAX", "2000000"))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return 2000000


def _log_big_text(label, text):
    cap = _prompt_log_cap()
    n = len(text)
    _chat_stderr(f"===== {label} length={n} =====")
    if cap is None or n <= cap:
        _chat_stderr(text)
    else:
        head = text[: cap // 2]
        tail = text[-cap // 2 :]
        _chat_stderr(head)
        _chat_stderr(f"... truncated middle ({n - len(head) - len(tail)} chars) ...")
        _chat_stderr(tail)
    _chat_stderr(f"===== end {label} =====")


def _summarize_command_args(cmd, args):
    try:
        if cmd == "load_model":
            return json.dumps(
                {
                    "model_name": args.get("model_name"),
                    "n_ctx": args.get("n_ctx"),
                    "n_gpu_layers": args.get("n_gpu_layers"),
                    "models_search_dirs": args.get("models_search_dirs") or args.get("models_dir"),
                },
                ensure_ascii=False,
                default=str,
            )
        if cmd == "chat":
            msgs = args.get("messages", []) or []
            return json.dumps(
                {
                    "message_count": len(msgs),
                    "message_roles": [m.get("role", "?") for m in msgs[-8:]],
                    "message_content_lens": [len(str(m.get("content", "") or "")) for m in msgs[-8:]],
                    "system_prompt_len": len(str(args.get("system_prompt", "") or "")),
                    "max_tokens": args.get("max_tokens"),
                    "temperature": args.get("temperature"),
                    "top_p": args.get("top_p"),
                    "top_k": args.get("top_k"),
                },
                ensure_ascii=False,
                default=str,
            )
        return json.dumps(args, ensure_ascii=False, default=str)
    except Exception as e:
        return f"<args summary failed {e!r}>"


def _summarize_chat_messages(chat_messages):
    return {
        "count": len(chat_messages),
        "roles": [m.get("role", "?") for m in chat_messages[-8:]],
        "content_lens": [len(str(m.get("content", "") or "")) for m in chat_messages[-8:]],
        "system_len": len(str(chat_messages[0].get("content", "") or "")) if chat_messages else 0,
    }


def _log_llama_gpu_status(where):
    """
    Actual llama.cpp / ggml GPU visibility. llama_supports_gpu_offload() triggers CUDA init on cuda builds
    (you'll see ggml_cuda_init + device list on stderr from native code too).
    """
    _chat_stderr(f"--- GPU status ({where}) ---")
    try:
        import llama_cpp.llama_cpp as L

        try:
            ok = bool(L.llama_supports_gpu_offload())
            _chat_stderr(f"llama_supports_gpu_offload() -> {ok}")
        except Exception as e:
            _chat_stderr(f"llama_supports_gpu_offload() raised: {e!r}")
            traceback.print_exc(file=sys.stderr)
    except Exception as e:
        _chat_stderr(f"llama_cpp.llama_cpp import for GPU probe failed: {e!r}")
    _chat_stderr(f"--- end GPU status ({where}) ---")


def _log_llm_instance(where, instance):
    _chat_stderr(f"--- Llama instance ({where}) ---")
    if instance is None:
        _chat_stderr("instance is None")
        return
    for name in (
        "model_path",
        "verbose",
        "n_ctx",
        "n_batch",
        "n_gpu_layers",
        "last_n_tokens_size",
    ):
        if hasattr(instance, name):
            try:
                v = getattr(instance, name)
                _chat_stderr(f"llm.{name}={v!r}")
            except Exception as e:
                _chat_stderr(f"llm.{name} <read err {e}>")
    # some versions expose context
    ctx = getattr(instance, "ctx", None)
    if ctx is not None:
        _chat_stderr(f"llm.ctx={ctx!r}")
    try:
        nc = instance.n_ctx()
        _chat_stderr(f"llm.n_ctx() -> {nc!r}")
    except Exception:
        pass
    try:
        nktv = instance.n_vocab()
        _chat_stderr(f"llm.n_vocab() -> {nktv!r}")
    except Exception:
        pass
    _chat_stderr(f"--- end Llama instance ({where}) ---")


def _genie_llama_verbose():
    """llama.cpp prints backend/GPU info to stderr when True. GENIE_LLAMA_VERBOSE=0 to shut up."""
    v = os.environ.get("GENIE_LLAMA_VERBOSE", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _gguf_training_context_max(path: str):
    """Max context from GGUF metadata only (no weight load). None if gguf missing or read fails."""
    try:
        from gguf import GGUFReader
    except ImportError:
        _chat_stderr("gguf not installed; n_ctx not capped from file (pip install gguf)")
        return None
    try:
        reader = GGUFReader(path)
    except Exception as e:
        _chat_stderr(f"GGUFReader({path!r}) failed: {e!r}")
        return None
    best = None
    for name, field in reader.fields.items():
        if not str(name).endswith(".context_length"):
            continue
        try:
            v = int(field.contents())
        except Exception:
            continue
        best = v if best is None else max(best, v)
    if best is None:
        # odd filenames (some quants) — any *context_length* token in key
        for name, field in reader.fields.items():
            if "context_length" not in str(name).lower():
                continue
            try:
                v = int(field.contents())
            except Exception:
                continue
            best = v if best is None else max(best, v)
    return best


def load_model(args):
    global llm, current_model_name, Llama, LLAMA_IMPORT_ERROR

    if Llama is None:
        try:
            libdir = prepare_llama_runtime()
            log(f"python={sys.executable}")
            log(f"llama lib dir={libdir}")
            import llama_cpp
            from llama_cpp import Llama as ImportedLlama
            Llama = ImportedLlama
            LLAMA_IMPORT_ERROR = None
            _log_llama_gpu_status("right after llama_cpp import (before Llama.load)")
        except Exception as e:
            LLAMA_IMPORT_ERROR = e
            return {
                "status": "error",
                "message": f"llama-cpp load failed: {e}"
            }
    model_name = args.get("model_name")
    search_dirs = args.get("models_search_dirs")
    if not search_dirs:
        legacy = args.get("models_dir")
        search_dirs = [legacy] if legacy else []
    if not search_dirs:
        search_dirs = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")]
    n_ctx_requested = int(args.get("n_ctx", 32768))
    n_gpu = args.get("n_gpu_layers", -1)

    if not model_name:
        return {"status": "error", "message": "No model name provided"}

    path = None
    for d in search_dirs:
        if not d:
            continue
        candidate = os.path.join(d, model_name)
        if os.path.isfile(candidate):
            path = candidate
            break
    if not path:
        return {
            "status": "error",
            "message": f"Model file not found: {model_name} (searched: {search_dirs})",
        }

    requested_ctx = max(256, n_ctx_requested)
    cap = _gguf_training_context_max(path)
    if cap is not None:
        n_ctx = min(requested_ctx, cap)
        if n_ctx < requested_ctx:
            _chat_stderr(
                f"n_ctx capped: requested {requested_ctx} -> {n_ctx} "
                f"(GGUF context_length max={cap})"
            )
        else:
            _chat_stderr(f"n_ctx={n_ctx} (within GGUF context_length={cap})")
    else:
        n_ctx = requested_ctx
        _chat_stderr(f"n_ctx={n_ctx} (requested={requested_ctx}, GGUF cap unknown)")

    try:
        if llm:
            del llm
        log(f"Loading {model_name} with ctx={n_ctx}...")
        _log_llama_gpu_status("immediately before Llama() constructor")
        lv = _genie_llama_verbose()
        _chat_stderr(
            f"Llama() kwargs: model_path={path!r} n_ctx={int(n_ctx)!r} n_gpu_layers={int(n_gpu)!r} verbose={lv!r}"
        )
        llm = Llama(
            model_path=path,
            n_ctx=int(n_ctx),
            n_gpu_layers=int(n_gpu),
            verbose=lv,
        )
        current_model_name = model_name
        _log_llama_gpu_status("immediately after Llama() constructor")
        _log_llm_instance("after successful load", llm)
        out = {
            "status": "success",
            "message": f"Loaded {model_name}",
            "n_ctx": int(n_ctx),
            "n_ctx_requested": int(requested_ctx),
        }
        if cap is not None:
            out["n_ctx_max_gguf"] = int(cap)
        return out
    except Exception as e:
        _chat_stderr(f"load_model exception: {e!r}")
        traceback.print_exc(file=sys.stderr)
        return {"status": "error", "message": str(e)}


def unload_model(args):
    global llm, current_model_name
    if llm:
        _chat_stderr("unload_model: dropping llm ref")
        del llm
        llm = None
        current_model_name = None
        log("Model unloaded, RAM freed")
        return {"status": "success", "message": "Model unloaded"}
    return {"status": "success", "message": "No model was loaded"}


def handle_chat(args):
    global llm
    if not llm:
        return {"status": "error", "message": "No model loaded."}

    _log_llama_gpu_status("handle_chat: entry (before create_chat_completion)")
    messages = args.get("messages", [])
    system_msg = _strip_surrogates(str(args.get("system_prompt", "You are a helpful assistant.") or ""))
    max_tokens = int(args.get("max_tokens", 512))
    temp = float(args.get("temperature", 0.3))
    top_p = float(args.get("top_p", 0.9))
    top_k = max(1, min(100, int(args.get("top_k", 40))))

    chat_messages = [{"role": "system", "content": system_msg}]
    for m in messages:
        role = m.get("role", "user")
        content = _strip_surrogates(str(m.get("content", "") or ""))
        if role == "system":
            continue
        chat_messages.append({"role": role, "content": content})

    kw_no_msgs = {
        "max_tokens": max_tokens,
        "temperature": temp,
        "top_p": top_p,
        "top_k": top_k,
        "stream": True,
    }
    _chat_stderr("create_chat_completion summary:", json.dumps(_summarize_chat_messages(chat_messages), ensure_ascii=False))
    _chat_stderr("sampling:", json.dumps(kw_no_msgs, ensure_ascii=False))
    _log_llama_gpu_status("immediately before llm.create_chat_completion")

    stream = llm.create_chat_completion(messages=chat_messages, **kw_no_msgs)

    full_response = ""
    n_tok = 0
    for output in stream:
        choice0 = output["choices"][0]
        delta = choice0.get("delta") or {}
        token = delta.get("content")
        if token is None:
            token = choice0.get("text") or ""
        token = token or ""
        if not token:
            continue
        token = _strip_surrogates(str(token))
        if not token:
            continue
        full_response += token
        n_tok += 1
        part = "thought" if is_inside_thought(full_response) else "message"
        print(json.dumps({"status": "stream", "part": part, "chunk": token}), flush=True)

    full_thought = "".join(m.group(1) or m.group(2) or "" for m in THOUGHT_BLOCK.finditer(full_response))
    full_message = THOUGHT_BLOCK.sub("", full_response).strip()

    _chat_stderr(
        f"handle_chat done: streamed_tokens={n_tok} response_chars={len(full_message)} thought_chars={len(full_thought)}"
    )

    result = {"status": "success", "response": full_message, "thought": full_thought or None}
    if current_model_name:
        result["model"] = current_model_name
    return result


if __name__ == "__main__":
    _chat_stderr(
        f"chat.py startup exe={sys.executable!r} GENIE_CHAT_DEBUG={_chat_debug()!r} "
        f"GENIE_LLAMA_VERBOSE={_genie_llama_verbose()!r}"
    )
    print(json.dumps({"status": "ready", "message": "Python Waiting for Config"}), flush=True)

    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            cmd = payload.get("command")
            args = payload.get("args", {})
            _ipc_log_incoming(cmd, args, len(line))

            if cmd == "load_model":
                result = load_model(args)
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
            elif cmd == "unload_model":
                result = unload_model(args)
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
            elif cmd == "chat":
                result = handle_chat(args)
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
            elif cmd == "download_model":
                result = {"status": "error", "message": "Download not implemented yet"}
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
            elif cmd == "ping":
                result = {"status": "success", "message": "pong"}
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
            else:
                result = {"status": "error", "message": f"Unknown command: {cmd}"}
                _ipc_log_outgoing(result)
                print(json.dumps(result), flush=True)
        except Exception as e:
            _chat_stderr("stdin loop exception:", repr(e))
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
