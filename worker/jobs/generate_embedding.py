"""B008: Paper Embedding generation job (`generate_embedding`, BT.B008, BE.F08)."""

from __future__ import annotations

import argparse
import logging
from typing import Any

from worker.config import get_config
from worker.db import get_connection, transaction
from worker.integrations.embedding_client import (
    compute_embedding_input_hash,
    fetch_embedding,
)
from worker.repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)


def generate_embedding(job: dict[str, Any]) -> None:
    """BT.B008 `generate_embedding`: Compute SHA-256 input hash, skip if unchanged/stale, or upsert 1536-dim vector."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])
    cfg = get_config()
    job_repo = JobRepository()

    if not cfg.embedding_enabled:
        with transaction() as tx_conn:
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id,
                       pv.paper_id,
                       pv.version,
                       p.latest_version,
                       p.title,
                       p.abstract,
                       pe.version AS existing_version,
                       pe.model_id AS existing_model_id,
                       pe.input_hash AS existing_input_hash
                FROM paper_versions pv
                JOIN papers p ON p.id = pv.paper_id
                LEFT JOIN paper_embeddings pe ON pe.paper_id = p.id
                WHERE pv.id = %s
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()

    if not row:
        with transaction() as tx_conn:
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    version = int(row["version"])
    latest_version = int(row["latest_version"])
    existing_ver = row.get("existing_version")

    # Skip if this version is older than the paper's latest_version or existing embedding version
    if version < latest_version or (
        existing_ver is not None and int(existing_ver) > version
    ):
        with transaction() as tx_conn:
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    input_text, input_hash = compute_embedding_input_hash(
        str(row["title"]), str(row["abstract"])
    )

    # Skip LLM API call if the existing embedding already matches the same input_hash and model
    if (
        row.get("existing_input_hash") == input_hash
        and row.get("existing_model_id") == cfg.llm_model_embedding
    ):
        with transaction() as tx_conn:
            if existing_ver != version:
                with tx_conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE paper_embeddings
                        SET paper_version_id = %s,
                            version = %s
                        WHERE paper_id = %s
                          AND version <= %s
                        """,
                        (paper_version_id, version, int(row["paper_id"]), version),
                    )
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    vec, actual_model = fetch_embedding(input_text)
    vec_literal = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"

    with transaction() as tx_conn:
        with tx_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO paper_embeddings (
                    paper_id, paper_version_id, version, model_id, input_hash, embedding, generated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s::vector, CURRENT_TIMESTAMP)
                ON CONFLICT (paper_id) DO UPDATE
                SET paper_version_id = EXCLUDED.paper_version_id,
                    version = EXCLUDED.version,
                    model_id = EXCLUDED.model_id,
                    input_hash = EXCLUDED.input_hash,
                    embedding = EXCLUDED.embedding,
                    generated_at = CURRENT_TIMESTAMP
                WHERE paper_embeddings.version <= EXCLUDED.version
                """,
                (
                    int(row["paper_id"]),
                    paper_version_id,
                    version,
                    actual_model,
                    input_hash,
                    vec_literal,
                ),
            )
        job_repo.mark_succeeded(tx_conn, job_id)


def enqueue_missing_embeddings(limit: int = 500) -> int:
    """BT.B008 `enqueue_missing_embeddings`: Backfill jobs for papers without embeddings on current model."""
    cfg = get_config()
    if not cfg.embedding_enabled:
        logger.warning("EMBEDDING_ENABLED is false; skipping backfill")
        return 0

    job_repo = JobRepository()
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id
                FROM papers p
                JOIN paper_versions pv
                  ON pv.paper_id = p.id
                 AND pv.version = p.latest_version
                LEFT JOIN paper_embeddings pe ON pe.paper_id = p.id
                WHERE EXISTS (
                    SELECT 1 FROM summaries s
                    WHERE s.paper_version_id = pv.id
                      AND s.validation_status = 'passed'
                )
                AND (pe.paper_id IS NULL OR pe.model_id <> %s)
                AND NOT EXISTS (
                    SELECT 1 FROM jobs j
                    WHERE j.paper_version_id = pv.id
                      AND j.job_type = 'generate_embedding'
                      AND j.status IN ('pending', 'running')
                )
                ORDER BY p.submitted_at DESC, p.id DESC
                LIMIT %s
                """,
                (cfg.llm_model_embedding, limit),
            )
            pv_ids = [int(r["paper_version_id"]) for r in cur.fetchall()]

    count = 0
    for pv_id in pv_ids:
        with transaction() as tx_conn:
            jid = job_repo.register_followup_job(
                tx_conn, pv_id, "generate_embedding"
            )
        if jid is not None and job_repo.enqueue(jid, "generate_embedding", "embedding"):
            count += 1
    logger.info("Enqueued %s generate_embedding backfill jobs", count)
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="B008 Embedding Generation CLI")
    parser.add_argument("--backfill", action="store_true", help="Enqueue missing embeddings")
    parser.add_argument("--limit", type=int, default=500, help="Max papers to backfill")
    args = parser.parse_args()
    if args.backfill:
        enqueue_missing_embeddings(limit=args.limit)


if __name__ == "__main__":
    main()
