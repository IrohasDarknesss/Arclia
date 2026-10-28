"""ReprocessRepository implementing BT.B010 DA001 - DA006."""

from __future__ import annotations

from typing import Any

from worker.db import get_connection


class DuplicateActiveJobError(RuntimeError):
    """Raised when DA002 hits uq_jobs_active_per_version (23505)."""


class ReprocessRepository:
    def list_failed_jobs(
        self,
        job_type: str | None,
        ids: list[int] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """BT.B010 DA001: Fetch failed jobs filtered by job_type and/or ids."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, job_type, paper_version_id, attempts, last_error
                    FROM   jobs
                    WHERE  status = 'failed'
                      AND  (%s::text     IS NULL OR job_type = %s)
                      AND  (%s::bigint[] IS NULL OR id = ANY(%s))
                    ORDER  BY id
                    LIMIT  %s
                    """,
                    (job_type, job_type, ids, ids, limit),
                )
                return [dict(r) for r in cur.fetchall()]

    def reset_failed_to_pending(self, job_id: int) -> dict[str, Any] | None:
        """BT.B010 DA002: Reset a failed job to pending with attempts = 0."""
        with get_connection(autocommit=True) as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE jobs
                        SET    status   = 'pending',
                               attempts = 0,
                               updated_at = CURRENT_TIMESTAMP
                        WHERE  id = %s
                          AND  status = 'failed'
                        RETURNING id, job_type, paper_version_id
                        """,
                        (job_id,),
                    )
                    row = cur.fetchone()
                    return dict(row) if row else None
            except Exception as exc:
                # PostgreSQL unique_violation SQLSTATE 23505 on uq_jobs_active_per_version
                if getattr(exc, "sqlstate", None) == "23505" or "uq_jobs_active_per_version" in str(exc):
                    raise DuplicateActiveJobError(
                        f"Active job already exists for same version and type (job_id={job_id})"
                    ) from exc
                raise

    def reset_running_to_pending(
        self, job_id: int, reason: str = "実行中のまま止まったため再処理で待機へ戻した"
    ) -> dict[str, Any] | None:
        """BT.B010 DA003: Reset a stuck running job to pending without resetting attempts."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                    SET    status     = 'pending',
                           last_error = %s,
                           updated_at = CURRENT_TIMESTAMP
                    WHERE  id = %s
                      AND  status = 'running'
                    RETURNING id, job_type, paper_version_id
                    """,
                    (reason, job_id),
                )
                row = cur.fetchone()
                return dict(row) if row else None

    def find_pending_jobs(self, ids: list[int]) -> list[dict[str, Any]]:
        """BT.B010 DA004: Verify which of the given job IDs are currently pending."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, job_type, paper_version_id
                    FROM   jobs
                    WHERE  id = ANY(%s)
                      AND  status = 'pending'
                    ORDER BY id
                    """,
                    (ids,),
                )
                return [dict(r) for r in cur.fetchall()]

    def count_failed_by_job_type(self) -> list[dict[str, Any]]:
        """BT.B010 DA005: Count failed jobs grouped by job_type."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT job_type, COUNT(*) AS failed_count
                    FROM   jobs
                    WHERE  status = 'failed'
                    GROUP  BY job_type
                    ORDER  BY job_type
                    """
                )
                return [
                    {"job_type": str(r["job_type"]), "failed_count": int(r["failed_count"])}
                    for r in cur.fetchall()
                ]

    def revert_pending_to_failed(self, job_id: int) -> None:
        """BT.B010 DA006: Compensating update when Redis enqueue fails right after DA002."""
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                    SET    status = 'failed',
                           updated_at = CURRENT_TIMESTAMP
                    WHERE  id = %s
                      AND  status = 'pending'
                    """,
                    (job_id,),
                )
