"""PaperVersionRepository implementing F04-BE DA005, DA006, DA014 and B001/B006 upserts."""

from __future__ import annotations

import json
from typing import Any

from worker.integrations.arxiv_client import ArxivEntry


class PaperVersionRepository:
    def load_with_paper(self, conn: Any, paper_version_id: int) -> dict[str, Any] | None:
        """F04-BE No.7 / DA005: Load paper_versions row joined with papers row."""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id,
                       pv.paper_id,
                       pv.version,
                       pv.metadata_snapshot,
                       pv.content_status,
                       pv.license_type,
                       p.arxiv_id,
                       p.title,
                       p.abstract,
                       p.authors,
                       p.categories,
                       p.latest_version,
                       p.original_url
                FROM paper_versions pv
                JOIN papers p ON p.id = pv.paper_id
                WHERE pv.id = %s
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def load_previous_version_snapshot(
        self, conn: Any, paper_id: int, current_version: int
    ) -> dict[str, Any] | None:
        """F04-BE No.8 / DA006: Load the immediate prior version (`version = current_version - 1`)."""
        if current_version <= 1:
            return None
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, version, metadata_snapshot
                FROM paper_versions
                WHERE paper_id = %s
                  AND version = %s
                """,
                (paper_id, current_version - 1),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def mark_full_text(self, conn: Any, paper_version_id: int) -> None:
        """F04-BE No.21 / DA014: Set `content_status = 'full_text'`."""
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE paper_versions
                SET content_status = 'full_text'
                WHERE id = %s
                """,
                (paper_version_id,),
            )

    def upsert_paper_and_version(
        self, conn: Any, entry: ArxivEntry
    ) -> tuple[int, int, bool]:
        """BT.B001 DA002-DA006 / BT.B006: Upsert `papers` and `paper_versions`.

        Returns `(paper_id, paper_version_id, is_new_version)`.
        """
        snapshot = entry.to_metadata_snapshot()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, latest_version
                FROM papers
                WHERE arxiv_id = %s
                FOR UPDATE
                """,
                (entry.arxiv_id,),
            )
            existing_paper = cur.fetchone()

            if existing_paper is None:
                cur.execute(
                    """
                    INSERT INTO papers (
                        arxiv_id, title, abstract, authors, categories,
                        submitted_at, updated_at, latest_version, original_url
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s::timestamptz, %s::timestamptz, %s, %s)
                    RETURNING id
                    """,
                    (
                        entry.arxiv_id,
                        entry.title,
                        entry.abstract,
                        json.dumps(entry.authors, ensure_ascii=False),
                        entry.categories,
                        entry.submitted_at,
                        entry.updated_at,
                        entry.version,
                        entry.original_url,
                    ),
                )
                paper_id = int(cur.fetchone()["id"])
            else:
                paper_id = int(existing_paper["id"])
                current_latest = int(existing_paper["latest_version"])
                if entry.version >= current_latest:
                    cur.execute(
                        """
                        UPDATE papers
                        SET title = %s,
                            abstract = %s,
                            authors = %s::jsonb,
                            categories = %s,
                            updated_at = GREATEST(submitted_at, %s::timestamptz),
                            latest_version = %s,
                            original_url = %s
                        WHERE id = %s
                        """,
                        (
                            entry.title,
                            entry.abstract,
                            json.dumps(entry.authors, ensure_ascii=False),
                            entry.categories,
                            entry.updated_at,
                            entry.version,
                            entry.original_url,
                            paper_id,
                        ),
                    )

            cur.execute(
                """
                SELECT id
                FROM paper_versions
                WHERE paper_id = %s
                  AND version = %s
                """,
                (paper_id, entry.version),
            )
            existing_ver = cur.fetchone()
            if existing_ver is not None:
                return paper_id, int(existing_ver["id"]), False

            cur.execute(
                """
                INSERT INTO paper_versions (
                    paper_id, version, metadata_snapshot, content_status, license_type
                )
                VALUES (%s, %s, %s::jsonb, 'abstract_only', %s)
                RETURNING id
                """,
                (
                    paper_id,
                    entry.version,
                    json.dumps(snapshot, ensure_ascii=False),
                    entry.license_type,
                ),
            )
            paper_version_id = int(cur.fetchone()["id"])
            return paper_id, paper_version_id, True
