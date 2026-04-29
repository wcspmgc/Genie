"""
LanceDB: connect by uri, create/open table by tableName, add vectors + text, search. All plaintext.
"""
import os
import lancedb

_db = None
_db_uri = None


def connect(uri=None):
    global _db, _db_uri
    if uri is None:
        uri = os.environ.get("LANCEDB_URI", "")
    if not uri:
        raise ValueError("LanceDB URI not set (LANCEDB_URI env or pass uri=)")
    if _db is not None and _db_uri == uri:
        return _db
    _db = lancedb.connect(uri)
    _db_uri = uri
    return _db


def get_table(db, table_name):
    """Open table if exists, else return None (caller can create)."""
    try:
        return db.open_table(table_name)
    except Exception:
        return None


def create_table_if_not_exists(db, table_name, vectors, texts, source=None):
    """
    Create table with columns vector (list of float), text (str). Optional source (str).
    vectors: list of lists (or numpy array); texts: list of str.
    """
    rows = []
    for i, (vec, txt) in enumerate(zip(vectors, texts)):
        row = {"vector": vec, "text": txt}
        if source is not None:
            row["source"] = source
        rows.append(row)
    if not rows:
        return
    return db.create_table(table_name, data=rows, mode="overwrite")


def add_to_table(db, table_name, vectors, texts, sources=None):
    """Append rows to existing table. Creates table if it doesn't exist. sources: optional list of str (one per row)."""
    tbl = get_table(db, table_name)
    rows = []
    for i, (vec, txt) in enumerate(zip(vectors, texts)):
        row = {"vector": vec, "text": txt}
        if sources is not None and i < len(sources):
            row["source"] = sources[i]
        rows.append(row)
    if not rows:
        return
    if tbl is None:
        db.create_table(table_name, data=rows)
    else:
        tbl.add(rows)


def search(db, table_name, query_vector, k=10):
    """
    Search table by vector. Returns list of dicts with at least 'text' and '_distance'.
    """
    tbl = get_table(db, table_name)
    if tbl is None:
        return []
    results = tbl.search(query_vector).limit(k).to_list()
    return results


def drop_table(db, table_name):
    """Remove table from database."""
    try:
        db.drop_table(table_name)
    except Exception:
        pass
