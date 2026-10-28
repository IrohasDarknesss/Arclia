"""F15: View events 180-day retention purge batch (`view_events_retention`, BE.F15 §5)."""

from __future__ import annotations

import logging

from worker.config import get_config
from worker.db import get_connection

logger = logging.getLogger(__name__)


def run_view_events_retention(
    batch_size: int = 5000,
    max_batches: int = 20,
) -> int:
    """BE.F15 DA003: Delete `view_events` older than `VIEW_EVENTS_RETENTION_DAYS` (default 180 days) in batches."""
    cfg = get_config()
    retention_days = max(1, cfg.view_events_retention_days)
    total_deleted = 0

    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            for _ in range(max_batches):
                cur.execute(
                    """
                    WITH target AS (
                      SELECT user_id, paper_id, viewed_at
                      FROM view_events
                      WHERE viewed_at < CURRENT_TIMESTAMP - make_interval(days => %s)
                      ORDER BY viewed_at ASC
                      LIMIT %s
                    )
                    DELETE FROM view_events ve
                    USING target t
                    WHERE ve.user_id   = t.user_id
                      AND ve.paper_id  = t.paper_id
                      AND ve.viewed_at = t.viewed_at
                    """,
                    (retention_days, batch_size),
                )
                deleted = cur.rowcount or 0
                total_deleted += deleted
                if deleted < batch_size:
                    break

    logger.info(
        "view_events_retention completed: deleted %s rows older than %s days",
        total_deleted,
        retention_days,
    )
    return total_deleted


if __name__ == "__main__":
    run_view_events_retention()
