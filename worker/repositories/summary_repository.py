"""SummaryRepository implementing F04-BE DA007 - DA013 (summaries & summary_citations)."""

from __future__ import annotations

import json
from typing import Any


class SummaryRepository:
    def find_passed_by_types(
        self,
        conn: Any,
        paper_version_id: int,
        summary_types: list[str],
    ) -> dict[str, dict[str, Any]]:
        """F04-BE No.9 / DA007: Find latest passed summaries for the given types."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (summary_type)
                       id, paper_version_id, summary_type, language,
                       json_content, model_id, generated_at, source_scope, validation_status
                FROM summaries
                WHERE paper_version_id = %s
                  AND summary_type = ANY(%s)
                  AND language = 'ja'
                  AND validation_status = 'passed'
                ORDER BY summary_type, generated_at DESC, id DESC
                """,
                (paper_version_id, summary_types),
            )
            rows = cur.fetchall()
            return {str(r["summary_type"]): dict(r) for r in rows}

    def copy_passed_summaries(
        self,
        conn: Any,
        from_paper_version_id: int,
        to_paper_version_id: int,
        summary_types: list[str],
    ) -> int:
        """F04-BE No.10 / DA008: Copy passed summaries and their citations from prior version (ARC001)."""
        prior_passed = self.find_passed_by_types(
            conn, from_paper_version_id, summary_types
        )
        copied = 0
        with conn.cursor() as cur:
            for stype in summary_types:
                src = prior_passed.get(stype)
                if not src:
                    continue
                cur.execute(
                    """
                    INSERT INTO summaries (
                        paper_version_id, summary_type, language, json_content,
                        model_id, source_scope, validation_status
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s, 'passed')
                    RETURNING id
                    """,
                    (
                        to_paper_version_id,
                        stype,
                        src["language"],
                        json.dumps(src["json_content"], ensure_ascii=False),
                        src["model_id"],
                        src["source_scope"],
                    ),
                )
                new_summary_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    INSERT INTO summary_citations (
                        summary_id, claim_id, source_section, source_page, source_url
                    )
                    SELECT %s, claim_id, source_section, source_page, source_url
                    FROM summary_citations
                    WHERE summary_id = %s
                    """,
                    (new_summary_id, src["id"]),
                )
                copied += 1
        return copied

    def insert_pending_with_citations(
        self,
        conn: Any,
        paper_version_id: int,
        summary_type: str,
        json_content: dict[str, Any],
        model_id: str,
        source_scope: str,
        citations: list[dict[str, Any]],
        language: str = "ja",
    ) -> int:
        """F04-BE No.11 / DA009: Insert a pending summary row and its summary_citations."""
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO summaries (
                    paper_version_id, summary_type, language, json_content,
                    model_id, source_scope, validation_status
                )
                VALUES (%s, %s, %s, %s::jsonb, %s, %s, 'pending')
                RETURNING id
                """,
                (
                    paper_version_id,
                    summary_type,
                    language,
                    json.dumps(json_content, ensure_ascii=False),
                    model_id,
                    source_scope,
                ),
            )
            summary_id = int(cur.fetchone()["id"])
            for cit in citations:
                cur.execute(
                    """
                    INSERT INTO summary_citations (
                        summary_id, claim_id, source_section, source_page, source_url
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        summary_id,
                        cit["claim_id"],
                        cit.get("source_section"),
                        cit.get("source_page"),
                        cit["source_url"],
                    ),
                )
            return summary_id

    def load_pending_by_version(
        self, conn: Any, paper_version_id: int
    ) -> list[dict[str, Any]]:
        """F04-BE No.12 / DA010: Load all pending summaries (latest per summary_type) and their citations."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (summary_type)
                       id, paper_version_id, summary_type, language,
                       json_content, model_id, generated_at, source_scope, validation_status
                FROM summaries
                WHERE paper_version_id = %s
                  AND validation_status = 'pending'
                ORDER BY summary_type, generated_at DESC, id DESC
                """,
                (paper_version_id,),
            )
            summaries = [dict(r) for r in cur.fetchall()]
            for s in summaries:
                cur.execute(
                    """
                    SELECT claim_id, source_section, source_page, source_url
                    FROM summary_citations
                    WHERE summary_id = %s
                    ORDER BY claim_id
                    """,
                    (s["id"],),
                )
                s["citations"] = [dict(c) for c in cur.fetchall()]
            return summaries

    def load_latest_failed_reasons(
        self, conn: Any, paper_version_id: int, summary_type: str
    ) -> list[str]:
        """F04-BE No.13 / DA011: Load rejection reasons stored on the latest failed summary or job error."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT last_error
                FROM jobs
                WHERE paper_version_id = %s
                  AND job_type = 'validate_summary'
                  AND last_error IS NOT NULL
                ORDER BY id DESC
                LIMIT 1
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()
            if row and row.get("last_error"):
                return [str(row["last_error"])]
            return []

    def update_validation_status(
        self, conn: Any, summary_id: int, validation_status: str
    ) -> None:
        """F04-BE No.14 / DA012: Update `validation_status` ('passed' or 'failed') on a summary."""
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE summaries
                SET validation_status = %s
                WHERE id = %s
                """,
                (validation_status, summary_id),
            )

    def count_failed_by_type(
        self, conn: Any, paper_version_id: int, summary_type: str
    ) -> int:
        """Count how many times a given summary_type has failed validation for this version (ARC004 max 2 retries)."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM summaries
                WHERE paper_version_id = %s
                  AND summary_type = %s
                  AND validation_status = 'failed'
                """,
                (paper_version_id, summary_type),
            )
            row = cur.fetchone()
            return int(row["cnt"]) if row else 0

    def exists_passed(self, conn: Any, paper_version_id: int) -> bool:
        """F04-BE No.25 / DA013: Return True if at least one passed summary exists for the version."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM summaries
                    WHERE paper_version_id = %s
                      AND validation_status = 'passed'
                ) AS has_passed
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()
            return bool(row and row["has_passed"])
