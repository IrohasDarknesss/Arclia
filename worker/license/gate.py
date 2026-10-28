"""License gate for full-text PDF parsing and redistribution (ARC005, BE.F04 No.22)."""

from __future__ import annotations

import re

# Allowed Creative Commons licenses that permit derivative works / full-text analysis (ARC005)
ALLOWED_FULL_TEXT_LICENSES: frozenset[str] = frozenset(
    {
        "http://creativecommons.org/licenses/by/4.0/",
        "https://creativecommons.org/licenses/by/4.0/",
        "http://creativecommons.org/licenses/by-sa/4.0/",
        "https://creativecommons.org/licenses/by-sa/4.0/",
        "http://creativecommons.org/publicdomain/zero/1.0/",
        "https://creativecommons.org/publicdomain/zero/1.0/",
        "CC BY 4.0",
        "CC BY-SA 4.0",
        "CC0 1.0",
    }
)


def normalize_license_url(license_type: str | None) -> str:
    """Normalize a license string or URL for comparison."""
    if not license_type:
        return ""
    trimmed = license_type.strip()
    if trimmed in ALLOWED_FULL_TEXT_LICENSES:
        return trimmed
    lowered = re.sub(r"^https://", "http://", trimmed.lower())
    if not lowered.endswith("/") and lowered.startswith("http://"):
        lowered = lowered + "/"
    return lowered


def is_full_text_allowed(license_type: str | None) -> bool:
    """Return True only when the paper version's license explicitly allows derivative works (ARC005).

    Allowed:
      - CC BY 4.0 (`http://creativecommons.org/licenses/by/4.0/`)
      - CC BY-SA 4.0 (`http://creativecommons.org/licenses/by-sa/4.0/`)
      - CC0 1.0 (`http://creativecommons.org/publicdomain/zero/1.0/`)

    Disallowed (fail-safe):
      - NULL / empty / unknown
      - arXiv non-exclusive distribution license (`http://arxiv.org/licenses/nonexclusive-distrib/1.0/`)
      - CC BY-NC / CC BY-ND / CC BY-NC-ND / CC BY-NC-SA
    """
    if not license_type or not license_type.strip():
        return False
    trimmed = license_type.strip()
    if trimmed in ALLOWED_FULL_TEXT_LICENSES:
        return True
    normalized = normalize_license_url(trimmed)
    return normalized in ALLOWED_FULL_TEXT_LICENSES
