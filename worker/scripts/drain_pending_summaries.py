"""Helper script to safely drain pending abstract summarization jobs adhering to Gemini Free Tier (15 RPM)."""

from __future__ import annotations

import logging
import sys
import time
from worker.db import get_connection, transaction
from worker.jobs.publish_summary import publish_summary
from worker.jobs.runner import JobRunner
from worker.jobs.summarize_abstract import summarize_abstract
from worker.jobs.validate_summary import validate_summary
from worker.repositories.job_repository import JobRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("drain_summaries")


def drain(limit: int = 10, sleep_sec: float = 4.5) -> None:
    runner = JobRunner()
    job_repo = JobRepository()

    processed = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, paper_version_id
                FROM jobs
                WHERE job_type = 'summarize_abstract'
                  AND status = 'pending'
                ORDER BY id ASC
                LIMIT %s;
                """,
                (limit,),
            )
            rows = cur.fetchall()

    logger.info("Found %d pending summarize_abstract jobs to process", len(rows))

    for row in rows:
        job_id = int(row["id"])
        pv_id = int(row["paper_version_id"])
        logger.info("Processing summarize_abstract job_id=%d for paper_version_id=%d", job_id, pv_id)

        # 1. Run summarize_abstract
        res = runner.run(job_id, summarize_abstract)
        logger.info("summarize_abstract result: %s", res)

        time.sleep(sleep_sec)

        # 2. Run validate_summary for this version if pending
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM jobs
                    WHERE paper_version_id = %s
                      AND job_type = 'validate_summary'
                      AND status = 'pending'
                    ORDER BY id ASC;
                    """,
                    (pv_id,),
                )
                val_rows = cur.fetchall()

        for vr in val_rows:
            v_id = int(vr["id"])
            logger.info("Running validate_summary job_id=%d", v_id)
            val_res = runner.run(v_id, validate_summary)
            logger.info("validate_summary result: %s", val_res)

        # 3. If standard summary also needs to be run (follow-up)
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM jobs
                    WHERE paper_version_id = %s
                      AND job_type = 'summarize_abstract'
                      AND status = 'pending'
                    ORDER BY id ASC;
                    """,
                    (pv_id,),
                )
                next_sum = cur.fetchall()

        for nsr in next_sum:
            time.sleep(sleep_sec)
            n_id = int(nsr["id"])
            logger.info("Running follow-up summarize_abstract job_id=%d", n_id)
            runner.run(n_id, summarize_abstract)
            time.sleep(sleep_sec)
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id FROM jobs
                        WHERE paper_version_id = %s
                          AND job_type = 'validate_summary'
                          AND status = 'pending'
                        ORDER BY id ASC;
                        """,
                        (pv_id,),
                    )
                    v2_rows = cur.fetchall()
            for v2 in v2_rows:
                runner.run(int(v2["id"]), validate_summary)

        # 4. Check if publish_summary can be executed
        with transaction() as tx:
            pub_id = job_repo.register_followup_job(tx, pv_id, "publish_summary")
        if pub_id:
            logger.info("Running publish_summary job_id=%d", pub_id)
            pub_res = runner.run(pub_id, publish_summary)
            logger.info("publish_summary result: %s", pub_res)

        processed += 1
        logger.info("Completed %d/%d papers", processed, len(rows))
        time.sleep(sleep_sec)


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    drain(limit=count)
