"""B001: arXiv metadata collection batch (`collect_metadata`, BT.B001, BE.F01)."""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from worker.config import get_config
from worker.db import get_connection, transaction
from worker.integrations.arxiv_client import ArxivHttpStatusError, fetch_arxiv_query
from worker.redis_client import enqueue_job, push_failure_entry
from worker.repositories.job_repository import JobRepository
from worker.repositories.paper_version_repository import PaperVersionRepository

logger = logging.getLogger(__name__)


def _build_category_date_query(
    categories: list[str],
    window_from: dt.datetime,
    window_to: dt.datetime,
) -> str:
    cat_expr = " OR ".join(f"cat:{c}" for c in categories)
    from_str = window_from.strftime("%Y%m%d%H%M")
    to_str = window_to.strftime("%Y%m%d%H%M")
    return f"({cat_expr}) AND lastUpdatedDate:[{from_str} TO {to_str}]"


def register_and_enqueue_collect_metadata(
    window_from: str | None = None,
    window_to: str | None = None,
) -> int | None:
    """Create a `collect_metadata` job in `jobs` (unless one is already pending/running) and enqueue it."""
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM jobs
                WHERE job_type = 'collect_metadata'
                  AND status IN ('pending', 'running')
                LIMIT 1
                """
            )
            if cur.fetchone():
                logger.info("collect_metadata job is already active; skipping registration")
                return None

            cur.execute(
                """
                INSERT INTO jobs (paper_version_id, job_type, status, attempts)
                VALUES (NULL, 'collect_metadata', 'pending', 0)
                RETURNING id
                """
            )
            job_id = int(cur.fetchone()["id"])

    args: dict[str, Any] = {}
    if window_from and window_to:
        args = {"window_from": window_from, "window_to": window_to}
    enqueue_job(
        queue_name="default",
        task_name="run_collect_metadata",
        job_id=job_id,
        args=args,
    )
    return job_id


def run_collect_metadata(
    job_id: int,
    window_from: str | None = None,
    window_to: str | None = None,
) -> dict[str, int]:
    """BT.B001 `run_collect_metadata`: Fetch new/updated arXiv papers, upsert DB, and enqueue B002."""
    cfg = get_config()
    job_repo = JobRepository()
    pv_repo = PaperVersionRepository()

    claimed = job_repo.claim(job_id)
    if claimed is None:
        logger.info("collect_metadata job %s already claimed or not pending", job_id)
        return {"fetched": 0, "new_versions": 0}

    now_utc = dt.datetime.now(dt.timezone.utc)
    if window_from and window_to:
        dt_from = dt.datetime.fromisoformat(window_from.replace("Z", "+00:00"))
        dt_to = dt.datetime.fromisoformat(window_to.replace("Z", "+00:00"))
    else:
        dt_to = now_utc
        dt_from = now_utc - dt.timedelta(days=max(1, cfg.arxiv_fetch_window_days))

    args_snapshot = {
        "window_from": dt_from.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_to": dt_to.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    search_query = _build_category_date_query(
        cfg.arxiv_target_categories, dt_from, dt_to
    )

    try:
        start = 0
        page_size = 100
        max_pages = 20  # Up to 2,000 entries per run
        total_fetched = 0
        new_versions_count = 0

        for _ in range(max_pages):
            entries, total_results = fetch_arxiv_query(
                search_query=search_query,
                start=start,
                max_results=page_size,
            )
            if not entries:
                break

            for entry in entries:
                total_fetched += 1
                b002_job_id: int | None = None
                with transaction() as conn:
                    _, paper_version_id, is_new_ver = pv_repo.upsert_paper_and_version(
                        conn, entry
                    )
                    if is_new_ver:
                        new_versions_count += 1
                        b002_job_id = job_repo.register_followup_job(
                            conn, paper_version_id, "summarize_abstract"
                        )
                if b002_job_id is not None:
                    job_repo.enqueue(
                        job_id=b002_job_id,
                        job_type="summarize_abstract",
                        queue_name="summarize",
                    )

            start += len(entries)
            if start >= total_results or len(entries) < page_size:
                break

        with transaction() as conn:
            job_repo.mark_succeeded(conn, job_id)

        logger.info(
            "collect_metadata job %s succeeded (fetched=%s, new_versions=%s)",
            job_id,
            total_fetched,
            new_versions_count,
        )
        return {"fetched": total_fetched, "new_versions": new_versions_count}

    except Exception as exc:
        force_fail = (
            isinstance(exc, ArxivHttpStatusError)
            and 400 <= exc.status_code < 500
            and exc.status_code != 429
        )
        res = job_repo.mark_failed_or_retry(
            job_id=job_id, error=exc, force_fail=force_fail
        )
        if res and res["status"] == "pending":
            delay = 300 if res["attempts"] == 1 else 900
            enqueue_job(
                queue_name="default",
                task_name="run_collect_metadata",
                job_id=job_id,
                args=args_snapshot,
                delay_seconds=delay,
            )
        elif res and res["status"] == "failed":
            push_failure_entry(
                job_type="collect_metadata",
                job_id=job_id,
                args=args_snapshot,
            )
        raise
