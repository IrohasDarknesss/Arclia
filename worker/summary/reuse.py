"""Version reuse helper for abstract-based summaries (ARC001, BE.F04 No.6)."""

from __future__ import annotations

import re


def normalize_abstract(text: str | None) -> str:
    """Normalize whitespace in an abstract for version equality comparison (ARC001)."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def can_reuse_abstract_summary(
    current_abstract: str | None,
    previous_abstract: str | None,
) -> bool:
    """Return True if the new version's abstract is identical to the previous version's abstract."""
    norm_curr = normalize_abstract(current_abstract)
    norm_prev = normalize_abstract(previous_abstract)
    return bool(norm_curr and norm_curr == norm_prev)
