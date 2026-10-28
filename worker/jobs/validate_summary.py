"""B003: Grounding and numerical validation job (`validate_summary`, BT.B003, ARC004, BE.F04 No.15)."""

from __future__ import annotations

import logging
from typing import Any

from worker.arxiv.pdf_client import ArxivPdfClient
from worker.db import get_connection, transaction
from worker.llm.client import LlmClient
from worker.pdf.parser import PdfParser
from worker.repositories.job_repository import JobRepository
from worker.repositories.paper_version_repository import PaperVersionRepository
from worker.repositories.summary_repository import SummaryRepository
from worker.summary.checker import check_grounding
from worker.summary.schema import validate_schema

logger = logging.getLogger(__name__)

MAX_REGENERATION_RETRIES = 2  # ARC004: at most 2 regenerations (3 total generations) per summary_type


def validate_summary(job: dict[str, Any]) -> None:
    """F04-BE No.15 / BT.B003: Validate pending summaries for a version and trigger B004 or regeneration."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])

    pv_repo = PaperVersionRepository()
    sum_repo = SummaryRepository()
    job_repo = JobRepository()
    llm = LlmClient()

    with get_connection(autocommit=True) as conn:
        pv = pv_repo.load_with_paper(conn, paper_version_id)
        if pv is None:
            raise RuntimeError(f"paper_version_id={paper_version_id} not found")

        pending_list = sum_repo.load_pending_by_version(conn, paper_version_id)
        if not pending_list:
            with transaction() as tx_conn:
                job_repo.mark_succeeded(tx_conn, job_id)
            return

        snapshot = pv.get("metadata_snapshot") or {}
        title = snapshot.get("title") or pv["title"]
        abstract = snapshot.get("abstract") or pv["abstract"]
        abstract_source = f"{title}\n\n{abstract}"

        # If any pending summary has source_scope == 'full_text', fetch & parse the PDF for verification
        full_text_source: str | None = None
        pdf_page_count: int | None = None
        if any(s["source_scope"] == "full_text" for s in pending_list):
            pdf_bytes = ArxivPdfClient().fetch_pdf(
                str(pv["arxiv_id"]), int(pv["version"])
            )
            parsed_pdf = PdfParser().extract_sections_and_pages(pdf_bytes)
            full_text_source = f"{title}\n\n{abstract}\n\n{parsed_pdf.full_text}"
            pdf_page_count = parsed_pdf.page_count

        decisions: list[tuple[int, str, str, list[str], int]] = []
        for s in pending_list:
            sid = int(s["id"])
            stype = str(s["summary_type"])
            sscope = str(s["source_scope"])
            jcontent = s["json_content"]
            citations = s.get("citations") or []

            reasons = validate_schema(stype, jcontent, citations)
            if not reasons:
                src_text = (
                    full_text_source
                    if (sscope == "full_text" and full_text_source)
                    else abstract_source
                )
                reasons = check_grounding(
                    summary_type=stype,
                    source_scope=sscope,
                    json_content=jcontent,
                    citations=citations,
                    source_text=src_text,
                    page_count=pdf_page_count if sscope == "full_text" else None,
                    llm_entailment_checker=llm.check_entailment,
                )

            prior_failures = sum_repo.count_failed_by_type(
                conn, paper_version_id, stype
            )
            status = "passed" if not reasons else "failed"
            decisions.append((sid, stype, status, reasons, prior_failures))

    any_passed = False
    need_regen_abstract = False
    need_regen_deep = False
    failure_notes: list[str] = []

    with transaction() as tx_conn:
        for sid, stype, status, reasons, prior_failures in decisions:
            sum_repo.update_validation_status(tx_conn, sid, status)
            if status == "passed":
                any_passed = True
            else:
                failure_notes.append(f"{stype}: {'; '.join(reasons[:3])}")
                # Total failed count after this failure is prior_failures + 1
                if prior_failures + 1 <= MAX_REGENERATION_RETRIES:
                    if stype in ("short", "standard"):
                        need_regen_abstract = True
                    elif stype == "deep":
                        need_regen_deep = True
                else:
                    logger.error(
                        "Summary regeneration limit (%s) reached for paper_version_id=%s, summary_type=%s",
                        MAX_REGENERATION_RETRIES,
                        paper_version_id,
                        stype,
                    )

        b004_id: int | None = None
        b002_id: int | None = None
        b005_id: int | None = None

        if any_passed:
            b004_id = job_repo.register_followup_job(
                tx_conn, paper_version_id, "publish_summary"
            )
        if need_regen_abstract:
            b002_id = job_repo.register_followup_job(
                tx_conn, paper_version_id, "summarize_abstract"
            )
        if need_regen_deep:
            b005_id = job_repo.register_followup_job(
                tx_conn, paper_version_id, "analyze_full_text"
            )

        if failure_notes:
            with tx_conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                    SET last_error = %s
                    WHERE id = %s
                    """,
                    (" / ".join(failure_notes)[:2000], job_id),
                )

        job_repo.mark_succeeded(tx_conn, job_id)

    if b004_id is not None:
        job_repo.enqueue(b004_id, "publish_summary", "default")
    if b002_id is not None:
        job_repo.enqueue(b002_id, "summarize_abstract", "summarize")
    if b005_id is not None:
        job_repo.enqueue(b005_id, "analyze_full_text", "fulltext")
