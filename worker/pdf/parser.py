"""PDF text and section parser using PyMuPDF (BT.B005, BE.F04 No.24)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore


class PdfParseError(RuntimeError):
    """Raised when a PDF is encrypted, corrupted, or contains no extractable text."""


@dataclass
class ParsedPdfPage:
    page_number: int  # 1-based
    text: str
    headings: list[str]


@dataclass
class ParsedPdfDocument:
    page_count: int
    pages: list[ParsedPdfPage]
    full_text: str


_HEADING_RE = re.compile(
    r"^(?:(?:\d+(?:\.\d+)*)|(?:[IVX]+\.))?\s*(Abstract|Introduction|Related Work|Background|Method(?:ology|s)?|Approach|Experiments?|Results?|Discussion|Limitations?|Conclusion(?:s)?|References|Appendix.*)$",
    re.IGNORECASE,
)


class PdfParser:
    """Extracts page-by-page text and section headings from PDF bytes in memory (never written to disk)."""

    def extract_sections_and_pages(self, pdf_bytes: bytes) -> ParsedPdfDocument:
        if fitz is None:
            raise RuntimeError("PyMuPDF (fitz) is required for PDF parsing")
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception as exc:
            raise PdfParseError(f"Failed to open PDF stream: {exc}") from exc

        try:
            if doc.is_encrypted:
                raise PdfParseError("PDF is encrypted and cannot be parsed")
            page_count = len(doc)
            if page_count < 1:
                raise PdfParseError("PDF has 0 pages")

            pages: list[ParsedPdfPage] = []
            all_text_parts: list[str] = []

            for idx in range(page_count):
                page = doc[idx]
                page_num = idx + 1
                raw_text = page.get_text("text") or ""
                cleaned = raw_text.strip()
                headings: list[str] = []
                for line in cleaned.splitlines():
                    stripped = line.strip()
                    if 2 <= len(stripped) <= 80 and _HEADING_RE.match(stripped):
                        headings.append(stripped)
                pages.append(
                    ParsedPdfPage(
                        page_number=page_num,
                        text=cleaned,
                        headings=headings,
                    )
                )
                if cleaned:
                    all_text_parts.append(f"[Page {page_num}]\n{cleaned}")

            full_text = "\n\n".join(all_text_parts).strip()
            if not full_text:
                raise PdfParseError("PDF contains no extractable text (image-only PDF)")

            return ParsedPdfDocument(
                page_count=page_count,
                pages=pages,
                full_text=full_text,
            )
        finally:
            doc.close()
