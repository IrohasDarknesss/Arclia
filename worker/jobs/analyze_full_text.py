"""B005: Full-text PDF analysis & deep summary generation job (`analyze_full_text`, BT.B005, BE.F04 No.20)."""

from __future__ import annotations

import logging
from typing import Any

from worker.arxiv.pdf_client import ArxivPdfClient
from worker.config import get_config
from worker.db import get_connection, transaction
from worker.license.gate import ALLOWED_FULL_TEXT_LICENSES, is_full_text_allowed
from worker.llm.client import LlmClient
from worker.pdf.parser import PdfParser
from worker.repositories.job_repository import JobRepository
from worker.repositories.paper_version_repository import PaperVersionRepository
from worker.repositories.summary_repository import SummaryRepository
from worker.summary.schema import validate_schema

logger = logging.getLogger(__name__)


def analyze_full_text(job: dict[str, Any]) -> None:
    """F04-BE No.20 / BT.B005: Verify license gate, download & parse PDF, generate `deep` summary, and enqueue B003."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])

    pv_repo = PaperVersionRepository()
    sum_repo = SummaryRepository()
    job_repo = JobRepository()

    with get_connection(autocommit=True) as conn:
        pv = pv_repo.load_with_paper(conn, paper_version_id)
        if pv is None:
            raise RuntimeError(f"paper_version_id={paper_version_id} not found")

        # 1. License gate check (ARC005)
        license_type = pv.get("license_type")
        if not is_full_text_allowed(license_type):
            logger.info(
                "analyze_full_text job %s skipped: license '%s' not allowed for full-text parsing (ARC005)",
                job_id,
                license_type,
            )
            with transaction() as tx_conn:
                job_repo.mark_succeeded(tx_conn, job_id)
            return

        # 2. Check if a passed `deep` summary already exists
        passed = sum_repo.find_passed_by_types(conn, paper_version_id, ["deep"])
        if "deep" in passed:
            with transaction() as tx_conn:
                if pv.get("content_status") != "full_text":
                    pv_repo.mark_full_text(tx_conn, paper_version_id)
                b004_id = job_repo.register_followup_job(
                    tx_conn, paper_version_id, "publish_summary"
                )
                job_repo.mark_succeeded(tx_conn, job_id)
            if b004_id is not None:
                job_repo.enqueue(b004_id, "publish_summary", "default")
            return

        prior_reasons = sum_repo.load_latest_failed_reasons(
            conn, paper_version_id, "deep"
        )

    # 3. Fetch PDF from arXiv (respecting global 3s rate limit) and parse text in memory
    arxiv_id = str(pv["arxiv_id"])
    version_num = int(pv["version"])
    pdf_bytes = ArxivPdfClient().fetch_pdf(arxiv_id, version_num)
    parsed_doc = PdfParser().extract_sections_and_pages(pdf_bytes)

    snapshot = pv.get("metadata_snapshot") or {}
    title = snapshot.get("title") or pv["title"]
    abstract = snapshot.get("abstract") or pv["abstract"]

    # 4. Generate `deep` summary and citations via LLM
    llm = LlmClient()
    json_content, citations, model_id = llm.generate_summary(
        summary_type="deep",
        arxiv_id=arxiv_id,
        version=version_num,
        title=title,
        abstract=abstract,
        full_text=parsed_doc.full_text,
        rejection_reasons=prior_reasons if prior_reasons else None,
    )
    schema_errors = validate_schema("deep", json_content, citations)
    if schema_errors:
        raise RuntimeError(
            f"Generated deep summary failed schema validation: {'; '.join(schema_errors)}"
        )

    # 5. Persist pending deep summary, update content_status='full_text', and enqueue B003
    with transaction() as tx_conn:
        sum_repo.insert_pending_with_citations(
            conn=tx_conn,
            paper_version_id=paper_version_id,
            summary_type="deep",
            json_content=json_content,
            model_id=model_id,
            source_scope="full_text",
            citations=citations,
        )
        pv_repo.mark_full_text(tx_conn, paper_version_id)
        b003_id = job_repo.register_followup_job(
            tx_conn, paper_version_id, "validate_summary"
        )
        job_repo.mark_succeeded(tx_conn, job_id)

    if b003_id is not None:
        job_repo.enqueue(b003_id, "validate_summary", "default")


def enqueue_daily_full_text_candidates() -> int:
    """BT.B005 daily candidate selector (03:00 UTC): select top licensed papers and enqueue `analyze_full_text`."""
    cfg = get_config()
    limit = max(0, cfg.full_text_daily_limit)
    if limit == 0:
        return 0

    job_repo = JobRepository()
    allowed_licenses = list(ALLOWED_FULL_TEXT_LICENSES)

    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id
                FROM paper_versions pv
                JOIN papers p ON p.id = pv.paper_id AND pv.version = p.latest_version
                LEFT JOIN bookmarks b ON b.paper_id = p.id
                LEFT JOIN view_events ve
                       ON ve.paper_id = p.id
                      AND ve.viewed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                WHERE pv.license_type = ANY(%s)
                  AND EXISTS (
                      SELECT 1 FROM summaries s
                      WHERE s.paper_version_id = pv.id
                        AND s.summary_type IN ('short', 'standard')
                        AND s.validation_status = 'passed'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM summaries s
                      WHERE s.paper_version_id = pv.id
                        AND s.summary_type = 'deep'
                        AND s.validation_status = 'passed'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM jobs j
                      WHERE j.paper_version_id = pv.id
                        AND j.job_type = 'analyze_full_text'
                        AND j.status IN ('pending', 'running')
                  )
                GROUP BY pv.id, p.submitted_at
                ORDER BY COUNT(DISTINCT b.user_id) DESC,
                         COUNT(ve.paper_id) DESC,
                         p.submitted_at DESC,
                         pv.id DESC
                LIMIT %s
                """,
                (allowed_licenses, limit),
            )
            candidates = [int(r["paper_version_id"]) for r in cur.fetchall()]

    enqueued = 0
    for pv_id in candidates:
        with transaction() as tx_conn:
            jid = job_repo.register_followup_job(
                tx_conn, pv_id, "analyze_full_text"
            )
        if jid is not None and job_repo.enqueue(jid, "analyze_full_text", "fulltext"):
            enqueued += 1
    logger.info("Enqueued %s daily analyze_full_text candidate jobs", enqueued)
    return enqueued
