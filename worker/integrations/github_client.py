"""GitHub REST API client and URL extractor for B009 (IF08, BT.B009, BE.F14)."""

from __future__ import annotations

import base64
import re
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from worker.config import get_config

_GITHUB_URL_RE = re.compile(
    r"https?://github\.com/([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+)"
)
_EXCLUDED_OWNERS = frozenset(
    {
        "orgs",
        "topics",
        "features",
        "settings",
        "about",
        "pricing",
        "login",
        "join",
        "explore",
        "marketplace",
        "sponsors",
        "notifications",
        "issues",
        "pulls",
    }
)


class GitHubRateLimitError(RuntimeError):
    """Raised on 403/429 rate limit responses from GitHub API."""


def extract_github_candidates_from_abstract(abstract: str) -> list[str]:
    """Extract candidate `owner/repo` strings from GitHub URLs in an abstract (BE.F14 FN02)."""
    candidates: list[str] = []
    for match in _GITHUB_URL_RE.finditer(abstract or ""):
        owner = match.group(1).strip()
        repo = match.group(2).strip()
        if repo.endswith(".git"):
            repo = repo[:-4]
        repo = repo.rstrip(".,;:)]}>'\"")
        if not owner or not repo or owner.lower() in _EXCLUDED_OWNERS:
            continue
        full_name = f"{owner}/{repo}"
        if full_name not in candidates:
            candidates.append(full_name)
    return candidates


class GitHubClient:
    def __init__(self) -> None:
        self._cfg = get_config()

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": self._cfg.arxiv_user_agent,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self._cfg.github_token:
            headers["Authorization"] = f"Bearer {self._cfg.github_token}"
        return headers

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        url = f"{self._cfg.github_api_base_url.rstrip('/')}/{path.lstrip('/')}"
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            resp = client.get(url, headers=self._headers(), params=params)
            if resp.status_code == 404:
                return None
            if resp.status_code in (403, 429):
                raise GitHubRateLimitError(
                    f"GitHub API rate limit or forbidden ({resp.status_code})"
                )
            resp.raise_for_status()
            return resp.json()

    def search_repositories_by_arxiv_id(self, arxiv_id: str) -> list[dict[str, Any]]:
        data = self._get(
            "/search/repositories",
            params={"q": f'"{arxiv_id}" in:readme,description', "per_page": 5},
        )
        if not data or not isinstance(data.get("items"), list):
            return []
        return data["items"]

    def get_repository(self, full_name: str) -> dict[str, Any] | None:
        return self._get(f"/repos/{full_name}")

    def get_tree_paths(self, full_name: str, branch_or_sha: str) -> tuple[str, list[str]]:
        data = self._get(
            f"/repos/{full_name}/git/trees/{branch_or_sha}",
            params={"recursive": "1"},
        )
        if not data:
            return branch_or_sha, []
        commit_sha = str(data.get("sha") or branch_or_sha)
        tree = data.get("tree") or []
        paths: list[str] = []
        for item in tree:
            if isinstance(item, dict) and item.get("path"):
                paths.append(str(item["path"]))
                if len(paths) >= 200:
                    break
        return commit_sha, paths

    def get_readme_excerpt(self, full_name: str, max_chars: int = 8000) -> str:
        data = self._get(f"/repos/{full_name}/readme")
        if not data or not data.get("content"):
            return ""
        try:
            decoded = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            return decoded[:max_chars]
        except Exception:
            return ""
