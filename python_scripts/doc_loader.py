"""
Load one file into text + source.
Supports .txt, .md, .html/.htm, .pdf, .docx, .rtf.
Returns list of one dict: [{"text": str, "source": str}], or [] on failure.
"""
import os
import re
import unicodedata


def _read_file_try_encodings(path, encodings=("utf-8-sig", "utf-8", "cp1252", "latin-1")):
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _looks_like_minimal_par_rtf(rtf: str) -> bool:
    """real rtfs usually have \\fonttbl; hand-rolled ones often don't."""
    head = rtf[:8000].lower()
    if "\\fonttbl" in head or "\\colortbl" in head or "\\stylesheet" in head:
        return False
    return bool(re.match(r"^\{\\rtf\d*", rtf.strip(), re.IGNORECASE))


def _rtf_minimal_par_fallback(rtf: str):
    """tiny hand-made rtfs like {\\rtf1\\ansi + text.replace('\\n', r'\\par ') + '}'"""
    s = rtf.strip()
    if not s.lower().startswith("{\\rtf"):
        return None
    # use [\\]ansi so we don't hit regex \\a (bell) weirdness
    m = re.match(r"^\{\\rtf\d*[\\]ansi(?:cpg\d+)?", s, re.IGNORECASE)
    if not m:
        return None
    body = s[m.end() :].rstrip()
    if body.endswith("}"):
        body = body[:-1]
    body = re.sub(r"\\par\s*", "\n", body, flags=re.IGNORECASE)
    body = body.strip()
    return body or None


def _sanitize_text(text: str) -> str:
    if not text:
        return ""
    out = []
    for c in text:
        o = ord(c)
        if c in ("\n", "\r", "\t"):
            out.append(c)
            continue
        if 0x00 <= o <= 0x1F:
            continue
        if 0x7F <= o <= 0x9F:
            continue
        out.append(c)
    text = "".join(out)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _rtf_text_quality_ok(text: str) -> bool:
    text = _sanitize_text(text)
    if not text:
        return False
    if len(text) < 120:
        return True
    if re.search(r"\S{400,}", text):
        return False

    nonspace = [c for c in text if not c.isspace()]
    if not nonspace:
        return False

    letters = sum(c.isalpha() for c in nonspace)
    digits = sum(c.isdigit() for c in nonspace)
    symbols = sum(unicodedata.category(c).startswith("S") for c in nonspace)
    word_like = re.findall(r"[A-Za-z]{2,}", text)

    nonspace_n = len(nonspace)
    alnum_ratio = (letters + digits) / nonspace_n
    symbol_ratio = symbols / nonspace_n

    if re.search(r"[^\w\s.,;:?!()'\"/%&\-]{18,}", text):
        return False
    if len(text) > 300 and len(word_like) < max(8, len(text) // 200):
        return False
    if len(text) > 300 and alnum_ratio < 0.35 and symbol_ratio > 0.12:
        return False
    return True


def load_document(path):
    ext = os.path.splitext(path)[1].lower()
    source = os.path.basename(path)
    if ext not in (".txt", ".md", ".html", ".htm", ".pdf", ".docx", ".rtf"):
        return []
    try:
        if ext in (".txt", ".md"):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
            return [{"text": text, "source": source}]

        if ext in (".html", ".htm"):
            from bs4 import BeautifulSoup
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                html = f.read()
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text("\n")
            return [{"text": text, "source": source}]

        if ext == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(path)
            parts = []
            for i, page in enumerate(reader.pages, start=1):
                t = page.extract_text()
                if t:
                    parts.append(f"\n\n=== PAGE {i} ===\n{t}")
            text = "\n\n".join(parts)
            return [{"text": text, "source": source}]

        if ext == ".docx":
            import docx
            doc = docx.Document(path)
            parts = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n\n".join(parts)
            return [{"text": text, "source": source}]

        if ext == ".rtf":
            from striprtf.striprtf import rtf_to_text

            rtf = _read_file_try_encodings(path)
            if _looks_like_minimal_par_rtf(rtf):
                fb = _rtf_minimal_par_fallback(rtf)
                if fb:
                    fb = _sanitize_text(fb)
                    if fb:
                        return [{"text": fb, "source": source}]
            text = ""
            try:
                text = _sanitize_text((rtf_to_text(rtf) or "").strip())
            except Exception:
                text = ""
            if not text:
                fb = _rtf_minimal_par_fallback(rtf)
                if fb:
                    text = _sanitize_text(fb)
            if not text or not _rtf_text_quality_ok(text):
                return []
            return [{"text": text, "source": source}]
    except Exception:
        return []
    return []
