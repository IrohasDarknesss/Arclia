"""B011: Search index verification and publication milestone job (`update_search_index`, BT.B011)."""

from __future__ import annotations

import logging
from typing import Any

from worker.db import get_connection, transaction
from worker.repositories.job_repository import JobRepository
from worker.repositories.search_index_repository import SearchIndexRepository
from worker.repositories.summary_repository import SummaryRepository

logger = logging.getLogger(__name__)


def update_search_index(job: dict[str, Any]) -> None:
    """BT.B011 `update_search_index`: Verify version, passed summary, and PostgreSQL FTS lexeme readiness."""
    job_id = int(job["id"])
    paper_version_id = job.get("paperVersionId")

    idx_repo = SearchIndexRepository()
    sum_repo = SummaryRepository()
    job_repo = JobRepository()

    with get_connection(autocommit=True) as conn:
        info = idx_repo.load_version_for_index(conn, paper_version_id)
        if info is None:
            logger.warning(
                "update_search_index job %s: paper_version_id=%s not found; marking succeeded",
                job_id,
                paper_version_id,
            )
            with transaction() as tx_conn:
                job_repo.mark_succeeded(tx_conn, job_id)
            return

        has_passed = sum_repo.exists_passed(conn, int(info["paperVersionId"]))
        if not has_passed:
            logger.info(
                "update_search_index job %s: no passed summary for paper_version_id=%s; marking succeeded",
                job_id,
                paper_version_id,
            )
            with transaction() as tx_conn:
                job_repo.mark_succeeded(tx_conn, job_id)
            return

        if info["lexemeCount"] == 0:
            logger.warning(
                "update_search_index job %s: arxiv_id=%s (v%s) produced 0 FTS lexemes",
                job_id,
                info["arxivId"],
                info["version"],
            )

    with transaction() as tx_conn:
        job_repo.mark_succeeded(tx_conn, job_id)

    logger.info(
        "update_search_index job %s succeeded (arxiv_id=%s, version=%s, is_latest=%s, lexemes=%s)",
        job_id,
        info["arxivId"],
        info["version"],
        info["isLatest"],
        info["lexemeCount"],
    )
