"""PostgreSQL connection helper and secret redaction for the Arclia worker."""

from __future__ import annotations

import contextlib
import re
from typing import Any, Iterator

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore
    dict_row = None  # type: ignore

from worker.config import get_config

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"ghp_[A-Za-z0-9]{10,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{10,}"),
    re.compile(r"whsec_[A-Za-z0-9]{10,}"),
    re.compile(r"postgres(?:ql)?://[^\s'\"]+"),
    re.compile(r"redis(?:s)?://[^\s'\"]+"),
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
]


def sanitize_error_message(error: Exception | str, max_length: int = 2000) -> str:
    """Redact API keys, connection strings, and stack traces from job error messages (T009 §4.3 (6))."""
    raw = str(error).strip() if error else "Unknown error"
    first_line = raw.splitlines()[0] if raw else "Unknown error"
    sanitized = first_line
    for pattern in _SECRET_PATTERNS:
        sanitized = pattern.sub("[REDACTED]", sanitized)
    if not sanitized.strip():
        sanitized = type(error).__name__ if isinstance(error, Exception) else "Error"
    return sanitized[:max_length]


@contextlib.contextmanager
def get_connection(autocommit: bool = False) -> Iterator[Any]:
    """Open a PostgreSQL database connection with dictionary row factory."""
    if psycopg is None:
        raise RuntimeError("psycopg is required for database operations")
    cfg = get_config()
    conn = psycopg.connect(cfg.database_url, autocommit=autocommit, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


@contextlib.contextmanager
def transaction(conn: Any | None = None) -> Iterator[Any]:
    """Run a database transaction block (commits on exit, rolls back on exception)."""
    if conn is not None:
        with conn.transaction():
            yield conn
    else:
        with get_connection(autocommit=False) as new_conn:
            try:
                yield new_conn
                new_conn.commit()
            except Exception:
                new_conn.rollback()
                raise
