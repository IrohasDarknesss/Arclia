"""SearchIndexRepository implementing BT.B011 DA001."""

from __future__ import annotations

from typing import Any


class SearchIndexRepository:
    def load_version_for_index(
        self, conn: Any, paper_version_id: int | None
    ) -> dict[str, Any] | None:
        """BT.B011 DA001: Load version, paper, is_latest flag, and FTS lexeme count."""
        if paper_version_id is None:
            return None
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id                     AS paper_version_id,
                       pv.paper_id,
                       pv.version,
                       p.arxiv_id,
                       p.latest_version,
                       (pv.version = p.latest_version) AS is_latest,
                       length(to_tsvector('english', p.title || ' ' || p.abstract)) AS lexeme_count
                FROM   paper_versions pv
                JOIN   papers p ON p.id = pv.paper_id
                WHERE  pv.id = %s
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "paperVersionId": int(row["paper_version_id"]),
                "paperId": int(row["paper_id"]),
                "version": int(row["version"]),
                "arxivId": str(row["arxiv_id"]),
                "latestVersion": int(row["latest_version"]),
                "isLatest": bool(row["is_latest"]),
                "lexemeCount": int(row["lexeme_count"] or 0),
            }
