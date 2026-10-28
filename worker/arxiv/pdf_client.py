"""arXiv PDF client with global 3-second rate limiting and header/size verification (IF02, BT.B005, BE.F04 No.23)."""

from __future__ import annotations

from typing import Any

import httpx

from worker.config import get_config
from worker.redis_client import acquire_arxiv_request_slot

MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB limit


class PdfNotAvailableError(RuntimeError):
    """Raised when the PDF returns 404/410 or is not a valid PDF document (non-retryable)."""


class ArxivPdfClient:
    """Downloads version-pinned PDFs from arXiv respecting the global rate limit (ARC007)."""

    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client

    def fetch_pdf(self, arxiv_id: str, version: int) -> bytes:
        acquire_arxiv_request_slot(client=self._redis)
        cfg = get_config()
        base = cfg.arxiv_pdf_base_url.rstrip("/")
        url = f"{base}/{arxiv_id}v{version}.pdf"
        headers = {"User-Agent": cfg.arxiv_user_agent}

        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code in (404, 410):
                raise PdfNotAvailableError(
                    f"PDF not available at {url} (HTTP {resp.status_code})"
                )
            resp.raise_for_status()
            content = resp.content

        if len(content) > MAX_PDF_BYTES:
            raise PdfNotAvailableError(
                f"PDF exceeds maximum size limit of 50MB ({len(content)} bytes)"
            )
        if not content.startswith(b"%PDF-"):
            raise PdfNotAvailableError(
                f"Downloaded content from {url} does not start with %PDF- magic header"
            )
        return content
