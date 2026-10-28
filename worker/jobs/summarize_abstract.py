"""B002: Abstract-based summary generation job (`summarize_abstract`, BT.B002, BE.F04 No.6)."""

from __future__ import annotations

import logging
from typing import Any

from worker.db import get_connection, transaction
from worker.llm.client import LlmClient
from worker.repositories.job_repository import JobRepository
from worker.repositories.paper_version_repository import PaperVersionRepository
from worker.repositories.summary_repository import SummaryRepository
from worker.summary.reuse import can_reuse_abstract_summary
from worker.summary.schema import validate_schema

logger = logging.getLogger(__name__)


def summarize_abstract(job: dict[str, Any]) -> None:
    """F04-BE No.6 / BT.B002: Generate `short` and `standard` summaries from Abstract (or reuse if unchanged)."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])

    pv_repo = PaperVersionRepository()
    sum_repo = SummaryRepository()
    job_repo = JobRepository()

    with get_connection(autocommit=True) as conn:
        pv = pv_repo.load_with_paper(conn, paper_version_id)
        if pv is None:
            raise RuntimeError(f"paper_version_id={paper_version_id} not found")

        passed_map = sum_repo.find_passed_by_types(
            conn, paper_version_id, ["short", "standard"]
        )
        missing_types = [t for t in ("short", "standard") if t not in passed_map]

        if not missing_types:
            # Both short and standard already passed; proceed directly to publish_summary (B004)
            with transaction() as tx_conn:
                b004_id = job_repo.register_followup_job(
                    tx_conn, paper_version_id, "publish_summary"
                )
                job_repo.mark_succeeded(tx_conn, job_id)
            if b004_id is not None:
                job_repo.enqueue(b004_id, "publish_summary", "default")
            return

        # ARC001 check: if version >= 2 and abstract is identical to v(n-1), copy passed summaries
        version_num = int(pv["version"])
        snapshot = pv["metadata_snapshot"] or {}
        current_abstract = snapshot.get("abstract") or pv["abstract"]

        if version_num >= 2:
            prev_ver = pv_repo.load_previous_version_snapshot(
                conn, int(pv["paper_id"]), version_num
            )
            if prev_ver is not None:
                prev_snap = prev_ver.get("metadata_snapshot") or {}
                prev_abstract = prev_snap.get("abstract")
                if can_reuse_abstract_summary(current_abstract, prev_abstract):
                    with transaction() as tx_conn:
                        copied = sum_repo.copy_passed_summaries(
                            tx_conn,
                            int(prev_ver["id"]),
                            paper_version_id,
                            missing_types,
                        )
                        if copied == len(missing_types):
                            b004_id = job_repo.register_followup_job(
                                tx_conn, paper_version_id, "publish_summary"
                            )
                            job_repo.mark_succeeded(tx_conn, job_id)
                            if b004_id is not None:
                                job_repo.enqueue(b004_id, "publish_summary", "default")
                            logger.info(
                                "Reused %s passed summaries from v%s for paper_version_id=%s",
                                copied,
                                version_num - 1,
                                paper_version_id,
                            )
                            return

        # Generate missing summary types via LLM
        llm = LlmClient()
        title = snapshot.get("title") or pv["title"]
        arxiv_id = str(pv["arxiv_id"])

        generated_items: list[tuple[str, dict[str, Any], list[dict[str, Any]], str]] = []
        for stype in missing_types:
            prior_reasons = sum_repo.load_latest_failed_reasons(
                conn, paper_version_id, stype
            )
            json_content, citations, model_id = llm.generate_summary(
                summary_type=stype,
                arxiv_id=arxiv_id,
                version=version_num,
                title=title,
                abstract=current_abstract,
                rejection_reasons=prior_reasons if prior_reasons else None,
            )
            schema_errors = validate_schema(stype, json_content, citations)
            if schema_errors:
                raise RuntimeError(
                    f"Generated {stype} summary failed schema validation: {'; '.join(schema_errors)}"
                )
            generated_items.append((stype, json_content, citations, model_id))

    # Persist generated pending summaries + citations and enqueue B003 (validate_summary)
    with transaction() as tx_conn:
        for stype, json_content, citations, model_id in generated_items:
            sum_repo.insert_pending_with_citations(
                conn=tx_conn,
                paper_version_id=paper_version_id,
                summary_type=stype,
                json_content=json_content,
                model_id=model_id,
                source_scope="abstract_only",
                citations=citations,
            )
        b003_id = job_repo.register_followup_job(
            tx_conn, paper_version_id, "validate_summary"
        )
        job_repo.mark_succeeded(tx_conn, job_id)

    if b003_id is not None:
        job_repo.enqueue(b003_id, "validate_summary", "default")
