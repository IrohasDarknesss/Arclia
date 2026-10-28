"""arXiv Atom API client and XML parser (IF01, BT.B001, BT.B006, ARC007)."""

from __future__ import annotations

import datetime as dt
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from worker.config import get_config
from worker.redis_client import acquire_arxiv_request_slot

ATOM_NS = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"
OPENSEARCH_NS = "{http://a9.com/-/spec/opensearch/1.1/}"

_ARXIV_ID_VERSION_RE = re.compile(
    r"arxiv\.org/abs/([0-9]{4}\.[0-9]{4,5}|[a-z\-]+(?:\.[A-Za-z\-]+)?/[0-9]{7})(?:v([0-9]+))?$"
)


class ArxivHttpStatusError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ArxivEntry:
    arxiv_id: str
    version: int
    title: str
    abstract: str
    authors: list[dict[str, str | None]]
    categories: list[str]
    submitted_at: str
    updated_at: str
    original_url: str
    license_type: str | None = None
    fetched_at: str = field(
        default_factory=lambda: dt.datetime.now(dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    )

    def to_metadata_snapshot(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors,
            "categories": self.categories,
            "submitted_at": self.submitted_at,
            "updated_at": self.updated_at,
            "fetched_at": self.fetched_at,
        }


def _normalize_whitespace(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def parse_arxiv_atom_feed(xml_text: str, fetched_at: str | None = None) -> tuple[list[ArxivEntry], int]:
    """Parse arXiv Atom 1.0 XML into a list of ArxivEntry items and totalResults."""
    root = ET.fromstring(xml_text)
    total_el = root.find(f"{OPENSEARCH_NS}totalResults")
    total_results = int(total_el.text.strip()) if (total_el is not None and total_el.text) else 0

    now_iso = fetched_at or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entries: list[ArxivEntry] = []

    for entry_el in root.findall(f"{ATOM_NS}entry"):
        id_el = entry_el.find(f"{ATOM_NS}id")
        if id_el is None or not id_el.text:
            continue
        raw_id_url = id_el.text.strip()
        match = _ARXIV_ID_VERSION_RE.search(raw_id_url)
        if not match:
            continue
        arxiv_id = match.group(1)
        version = int(match.group(2)) if match.group(2) else 1

        title_el = entry_el.find(f"{ATOM_NS}title")
        summary_el = entry_el.find(f"{ATOM_NS}summary")
        published_el = entry_el.find(f"{ATOM_NS}published")
        updated_el = entry_el.find(f"{ATOM_NS}updated")

        title = _normalize_whitespace(title_el.text if title_el is not None else "")
        abstract = _normalize_whitespace(summary_el.text if summary_el is not None else "")
        if not title or not abstract:
            continue

        submitted_at = (published_el.text.strip() if (published_el is not None and published_el.text) else now_iso)
        updated_at = (updated_el.text.strip() if (updated_el is not None and updated_el.text) else submitted_at)

        authors: list[dict[str, str | None]] = []
        for author_el in entry_el.findall(f"{ATOM_NS}author"):
            name_el = author_el.find(f"{ATOM_NS}name")
            aff_el = author_el.find(f"{ARXIV_NS}affiliation")
            name = _normalize_whitespace(name_el.text if name_el is not None else "")
            aff = _normalize_whitespace(aff_el.text if aff_el is not None else "") or None
            if name:
                authors.append({"name": name, "affiliation": aff})
        if not authors:
            continue

        categories: list[str] = []
        primary_cat_el = entry_el.find(f"{ARXIV_NS}primary_category")
        if primary_cat_el is not None:
            term = (primary_cat_el.attrib.get("term") or "").strip()
            if term:
                categories.append(term)
        for cat_el in entry_el.findall(f"{ATOM_NS}category"):
            term = (cat_el.attrib.get("term") or "").strip()
            if term and term not in categories:
                categories.append(term)
        if not categories:
            continue

        license_el = entry_el.find(f"{ARXIV_NS}license")
        license_type = (
            license_el.text.strip()
            if (license_el is not None and license_el.text and license_el.text.strip())
            else None
        )

        entries.append(
            ArxivEntry(
                arxiv_id=arxiv_id,
                version=version,
                title=title,
                abstract=abstract,
                authors=authors,
                categories=categories,
                submitted_at=submitted_at,
                updated_at=updated_at,
                original_url=f"https://arxiv.org/abs/{arxiv_id}",
                license_type=license_type,
                fetched_at=now_iso,
            )
        )

    return entries, total_results


def fetch_arxiv_query(
    search_query: str,
    start: int = 0,
    max_results: int = 100,
    sort_by: str = "lastUpdatedDate",
    sort_order: str = "descending",
    redis_client: Any | None = None,
) -> tuple[list[ArxivEntry], int]:
    """Query the arXiv API after acquiring the global 3-second Redis slot (ARC007)."""
    acquire_arxiv_request_slot(client=redis_client)
    cfg = get_config()
    params = {
        "search_query": search_query,
        "start": str(start),
        "max_results": str(max_results),
        "sortBy": sort_by,
        "sortOrder": sort_order,
    }
    headers = {"User-Agent": cfg.arxiv_user_agent}
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        resp = client.get(cfg.arxiv_api_base_url, params=params, headers=headers)
        if resp.status_code != 200:
            raise ArxivHttpStatusError(
                resp.status_code,
                f"arXiv API returned HTTP {resp.status_code}",
            )
        return parse_arxiv_atom_feed(resp.text)
