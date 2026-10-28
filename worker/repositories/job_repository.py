"""JobRepository implementing F04-BE DA001 - DA004 (claim, mark_succeeded, mark_failed_or_retry, enqueue)."""

from __future__ import annotations

from typing import Any

from worker.config import get_config
from worker.db import get_connection, sanitize_error_message
from worker.redis_client import enqueue_job


class JobStateConflict(RuntimeError):
    """Raised when a job's status was modified concurrently and is no longer 'running'."""


class JobRepository:
    def claim(self, job_id: int) -> dict[str, Any] | None:
        """F04-BE No.2 / DA001: Atomically transition a pending job to running."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                    SET status = 'running',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                      AND status = 'pending'
                    RETURNING id, paper_version_id, job_type, attempts
                    """,
                    (job_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": int(row["id"]),
                    "paperVersionId": row["paper_version_id"],
                    "jobType": str(row["job_type"]),
                    "attempts": int(row["attempts"]),
                }

    def mark_succeeded(self, conn: Any, job_id: int) -> None:
        """F04-BE No.3 / DA002: Mark a running job as succeeded within caller's transaction."""
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE jobs
                SET status = 'succeeded',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                  AND status = 'running'
                """,
                (job_id,),
            )
            if cur.rowcount == 0:
                raise JobStateConflict(
                    f"Job {job_id} is no longer in 'running' state"
                )

    def mark_failed_or_retry(
        self,
        job_id: int,
        error: Exception | str,
        force_fail: bool = False,
    ) -> dict[str, Any] | None:
        """F04-BE No.4 / DA003: Increment attempts, record sanitized error, set pending or failed."""
        cfg = get_config()
        max_attempts = cfg.job_max_attempts
        sanitized = sanitize_error_message(error)
        effective_limit = 1 if force_fail else max_attempts

        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                    SET attempts = attempts + 1,
                        last_error = %s,
                        status = CASE WHEN attempts + 1 >= %s THEN 'failed' ELSE 'pending' END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                      AND status = 'running'
                    RETURNING status, attempts
                    """,
                    (sanitized, effective_limit, job_id),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "status": str(row["status"]),
                    "attempts": int(row["attempts"]),
                }

    def register_followup_job(
        self,
        conn: Any,
        paper_version_id: int,
        job_type: str,
    ) -> int | None:
        """F04-BE DA004: Insert a pending job for `(paper_version_id, job_type)` if not already active."""
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO jobs (paper_version_id, job_type, status, attempts)
                VALUES (%s, %s, 'pending', 0)
                ON CONFLICT (paper_version_id, job_type)
                  WHERE status IN ('pending', 'running') AND paper_version_id IS NOT NULL
                DO NOTHING
                RETURNING id
                """,
                (paper_version_id, job_type),
            )
            row = cur.fetchone()
            return int(row["id"]) if row else None

    def enqueue(
        self,
        job_id: int,
        job_type: str,
        queue_name: str,
        task_name: str = "run",
        args: dict[str, Any] | None = None,
        delay_seconds: int = 0,
    ) -> bool:
        """F04-BE No.5: Push a committed job ID onto its Redis queue."""
        return enqueue_job(
            queue_name=queue_name,
            task_name=task_name,
            job_id=job_id,
            args={"jobType": job_type, **(args or {})},
            delay_seconds=delay_seconds,
        )
