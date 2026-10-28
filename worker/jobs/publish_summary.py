"""B004: Summary publication reflection job (`publish_summary`, BT.B004, BE.F04 No.16)."""

from __future__ import annotations

import logging
from typing import Any

from worker.config import get_config
from worker.db import get_connection, transaction
from worker.repositories.job_repository import JobRepository
from worker.repositories.summary_repository import SummaryRepository

logger = logging.getLogger(__name__)


def publish_summary(job: dict[str, Any]) -> None:
    """F04-BE No.16 / BT.B004: Verify passed summary exists and enqueue B011 (`update_search_index`) and B008 (`generate_embedding`)."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])
    cfg = get_config()

    sum_repo = SummaryRepository()
    job_repo = JobRepository()

    with get_connection(autocommit=True) as conn:
        has_passed = sum_repo.exists_passed(conn, paper_version_id)

    b011_id: int | None = None
    b008_id: int | None = None

    with transaction() as tx_conn:
        if has_passed:
            b011_id = job_repo.register_followup_job(
                tx_conn, paper_version_id, "update_search_index"
            )
            if cfg.embedding_enabled:
                b008_id = job_repo.register_followup_job(
                    tx_conn, paper_version_id, "generate_embedding"
                )
        else:
            logger.info(
                "publish_summary job %s: no passed summary for paper_version_id=%s; skipping followup jobs",
                job_id,
                paper_version_id,
            )
        job_repo.mark_succeeded(tx_conn, job_id)

    if b011_id is not None:
        job_repo.enqueue(b011_id, "update_search_index", "default")
    if b008_id is not None:
        job_repo.enqueue(b008_id, "generate_embedding", "embedding")
