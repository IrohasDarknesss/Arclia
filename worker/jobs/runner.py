"""JobRunner implementing F04-BE No.1 (`run`) common execution frame (ARC006)."""

from __future__ import annotations

import logging
from typing import Any, Callable

from worker.arxiv.pdf_client import PdfNotAvailableError
from worker.integrations.embedding_client import EmbeddingValidationError
from worker.jobs.routes import resolve_route
from worker.pdf.parser import PdfParseError
from worker.redis_client import enqueue_job, push_failure_entry
from worker.repositories.job_repository import JobRepository, JobStateConflict

logger = logging.getLogger(__name__)

NON_RETRYABLE_EXCEPTIONS = (
    PdfNotAvailableError,
    PdfParseError,
    EmbeddingValidationError,
)


class JobRunner:
    """Executes version-bound jobs (B002, B003, B004, B005, B008, B009, B011) with claim, retry, and dead-letter handling."""

    def __init__(self, job_repo: JobRepository | None = None) -> None:
        self._job_repo = job_repo or JobRepository()

    def run(
        self,
        job_id: int,
        handler: Callable[[dict[str, Any]], None],
        extra_args: dict[str, Any] | None = None,
    ) -> str:
        """F04-BE No.1: Claim job, invoke handler, and handle retries or dead-letter queue on failure."""
        claimed = self._job_repo.claim(job_id)
        if claimed is None:
            logger.info("Job %s skipped (already running or not pending)", job_id)
            return "skipped_claim"

        job_type = claimed["jobType"]
        route = resolve_route(job_type)

        try:
            handler(claimed)
            return "succeeded"
        except JobStateConflict as exc:
            logger.warning("JobStateConflict on job %s (%s): %s", job_id, job_type, exc)
            return "state_conflict"
        except Exception as exc:
            force_fail = isinstance(exc, NON_RETRYABLE_EXCEPTIONS)
            result = self._job_repo.mark_failed_or_retry(
                job_id=job_id,
                error=exc,
                force_fail=force_fail,
            )
            if result is None:
                logger.warning(
                    "Job %s state changed before failure could be recorded", job_id
                )
                return "state_conflict"

            status = result["status"]
            attempts = result["attempts"]

            if status == "pending":
                delay = (
                    route.retry_delays_seconds[0]
                    if attempts == 1
                    else route.retry_delays_seconds[1]
                )
                enqueue_job(
                    queue_name=route.queue,
                    task_name=route.task,
                    job_id=job_id,
                    args={"jobType": job_type, **(extra_args or {})},
                    delay_seconds=delay,
                )
                logger.warning(
                    "Job %s (%s) failed attempt %s; re-queued to '%s' with %ss delay",
                    job_id,
                    job_type,
                    attempts,
                    route.queue,
                    delay,
                )
                return "retrying"
            else:
                push_failure_entry(
                    job_type=job_type,
                    job_id=job_id,
                    args=extra_args,
                )
                logger.error(
                    "Job %s (%s) permanently failed after %s attempts; pushed to jobs:failed",
                    job_id,
                    job_type,
                    attempts,
                )
                return "failed"
