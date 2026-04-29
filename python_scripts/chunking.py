"""
Simple recursive-style text splitter: split by paragraph, then line, then words.
chunk_size in chars, overlap in chars. Returns list of (text, source) tuples.
"""

import re


_FIXED_RE = re.compile(r"^fixed_(\d+)_o(\d+)$")


def _looks_like_garbage_piece(text: str) -> bool:
    if not text:
        return True
    s = text.strip()
    if len(s) < 120:
        return False
    if re.search(r"\S{400,}", s):
        return True
    if re.search(r"[^\w\s.,;:?!()'\"/%&\-]{18,}", s):
        return True
    word_like = re.findall(r"[A-Za-z]{2,}", s)
    nonspace = [c for c in s if not c.isspace()]
    if not nonspace:
        return True
    alnum_ratio = sum((c.isalpha() or c.isdigit()) for c in nonspace) / len(nonspace)
    if len(s) > 300 and len(word_like) < max(6, len(s) // 240) and alnum_ratio < 0.35:
        return True
    return False


def _split_recursive(text, chunk_size, overlap, separators=("\n\n", "\n", " ")):
    if not text or chunk_size <= 0:
        return []
    if len(text) <= chunk_size:
        return [text]

    for sep in separators:
        if sep in text:
            parts = text.split(sep)
            chunks = []
            current = []
            current_len = 0

            for i, p in enumerate(parts):
                piece = p if i == 0 else sep + p
                if current_len + len(piece) <= chunk_size:
                    current.append(piece)
                    current_len += len(piece)
                else:
                    if current:
                        chunk = "".join(current)
                        chunks.append(chunk)
                        # overlap: keep last overlap chars
                        if overlap > 0 and len(chunk) > overlap:
                            overlap_text = chunk[-overlap:]
                            current = [overlap_text]
                            current_len = len(overlap_text)
                        else:
                            current = []
                            current_len = 0
                    current = [piece]
                    current_len = len(piece)
            if current:
                chunks.append("".join(current))
            return chunks

    # no separator found, split by char
    return [text[i:i + chunk_size] for i in range(0, len(text), chunk_size - overlap)]


def _split_fixed_tokens(text: str, tokens_per_chunk: int, overlap_tokens: int) -> list[str]:
    # cheap "tokens" ~= whitespace words. not perfect, but deterministic and no extra deps.
    if not text or tokens_per_chunk <= 0:
        return []
    words = text.split()
    if not words:
        return []
    if len(words) <= tokens_per_chunk:
        return [" ".join(words)]

    overlap_tokens = max(0, int(overlap_tokens))
    step = max(1, tokens_per_chunk - overlap_tokens)
    out: list[str] = []
    for start in range(0, len(words), step):
        chunk = words[start : start + tokens_per_chunk]
        if not chunk:
            break
        out.append(" ".join(chunk))
        if start + tokens_per_chunk >= len(words):
            break
    return out


def chunk_documents(documents, chunk_size, overlap, method="recursive"):
    """documents: list of {"text", "source"}. overlap in chars. Returns list of (text, source)."""
    if not documents:
        return []
    overlap = max(0, int(overlap))
    result = []
    method = (method or "recursive").strip()
    fixed = _FIXED_RE.match(method)
    for doc in documents:
        text = doc.get("text", "")
        source = doc.get("source", "unknown")
        if not text.strip():
            continue
        try:
            if fixed:
                toks = int(fixed.group(1))
                ov = int(fixed.group(2))
                # fixed token mode gets weird fast if extraction left us giant no-space blobs
                if re.search(r"\S{400,}", text):
                    pieces = _split_recursive(text, int(chunk_size), overlap)
                else:
                    pieces = _split_fixed_tokens(text, toks, ov)
            else:
                pieces = _split_recursive(text, int(chunk_size), overlap)
            for piece in pieces:
                if piece.strip() and not _looks_like_garbage_piece(piece):
                    result.append((piece.strip(), source))
        except Exception:
            pass
    return result
