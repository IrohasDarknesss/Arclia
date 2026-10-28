"""B006: On-demand search sync job (`sync_on_demand`, BT.B006, BE.F03)."""

from __future__ import annotations

import logging
import re
from typing import Any

from worker.db import transaction
from worker.integrations.arxiv_client import ArxivHttpStatusError, fetch_arxiv_query
from worker.redis_client import enqueue_job, push_failure_entry
from worker.repositories.job_repository import JobRepository
from worker.repositories.paper_version_repository import PaperVersionRepository

logger = logging.getLogger(__name__)

_ARXIV_ID_EXACT_RE = re.compile(
    r"^([0-9]{4}\.[0-9]{4,5}|[a-z\-]+(?:\.[A-Za-z\-]+)?/[0-9]{7})(?:v[0-9]+)?$"
)


def _build_on_demand_arxiv_query(q: str | None, category: str | None) -> str:
    parts: list[str] = []
    if q and q.strip():
        cleaned = q.strip()
        m = _ARXIV_ID_EXACT_RE.match(cleaned)
        if m:
            parts.append(f"id:{m.group(1)}")
        else:
            tokens = [re.sub(r'["()]', "", tok) for tok in cleaned.split() if tok]
            if tokens:
                expr = " AND ".join(f"all:{t}" for t in tokens[:8])
                parts.append(f"({expr})")
    if category and category.strip():
        parts.append(f"cat:{category.strip()}")
    return " AND ".join(parts)


def run_sync_on_demand(
    job_id: int,
    q: str | None = None,
    category: str | None = None,
) -> dict[str, int]:
    """BT.B006 `run_sync_on_demand`: Fetch up to 5 matching papers from arXiv and upsert them."""
    job_repo = JobRepository()
    pv_repo = PaperVersionRepository()

    claimed = job_repo.claim(job_id)
    if claimed is None:
        logger.info("sync_on_demand job %s already claimed or not pending", job_id)
        return {"fetched": 0, "new_versions": 0}

    norm_q = (q or "").strip() or None
    norm_cat = (category or "").strip() or None
    if not norm_q and not norm_cat:
        # Permanent failure when search arguments are missing (BT.B006 §4 Step 5)
        job_repo.mark_failed_or_retry(
            job_id=job_id,
            error=ValueError("sync_on_demand requires q or category"),
            force_fail=True,
        )
        return {"fetched": 0, "new_versions": 0}

    args_for_retry = {"jobId": job_id, "q": norm_q, "category": norm_cat}
    search_query = _build_on_demand_arxiv_query(norm_q, norm_cat)

    try:
        entries, _ = fetch_arxiv_query(
            search_query=search_query,
            start=0,
            max_results=5,
            sort_by="relevance" if norm_q else "submittedDate",
            sort_order="descending",
        )
        new_versions = 0
        for entry in entries:
            b002_id: int | None = None
            with transaction() as conn:
                _, pv_id, is_new_ver = pv_repo.upsert_paper_and_version(conn, entry)
                if is_new_ver:
                    new_versions += 1
                    b002_id = job_repo.register_followup_job(
                        conn, pv_id, "summarize_abstract"
                    )
            if b002_id is not None:
                job_repo.enqueue(b002_id, "summarize_abstract", "summarize")

        with transaction() as conn:
            job_repo.mark_succeeded(conn, job_id)

        return {"fetched": len(entries), "new_versions": new_versions}

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
            delay = 60 if res["attempts"] == 1 else 300
            enqueue_job(
                queue_name="sync_on_demand",
                task_name="run_sync_on_demand",
                job_id=job_id,
                args=args_for_retry,
                delay_seconds=delay,
            )
        elif res and res["status"] == "failed":
            push_failure_entry(
                job_type="sync_on_demand",
                job_id=job_id,
                args=args_for_retry,
            )
        raise
