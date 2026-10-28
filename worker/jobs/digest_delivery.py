"""B007: Daily email digest delivery job (`digest_delivery`, BT.B007, BE.F10)."""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from worker.config import get_config
from worker.db import get_connection, sanitize_error_message, transaction
from worker.integrations.mail_client import (
    fetch_user_emails_from_auth,
    send_digest_email,
)
from worker.redis_client import enqueue_job, push_failure_entry

logger = logging.getLogger(__name__)

JST = dt.timezone(dt.timedelta(hours=9))


def run_digest_delivery(
    run_at: str | None = None,
    delivery_date: str | None = None,
    attempt: int = 0,
) -> dict[str, int]:
    """BT.B007 FN01 `run_digest_delivery`: Deliver daily digest emails to opted-in users and purge >90d logs."""
    cfg = get_config()
    now_utc = dt.datetime.now(dt.timezone.utc)
    eff_run_at = run_at or now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    eff_delivery_date = delivery_date or now_utc.astimezone(JST).strftime("%Y-%m-%d")

    try:
        with get_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                # 1. Load target users with digest_enabled=true who have not yet been sent/skipped today
                cur.execute(
                    """
                    SELECT uns.user_id::text AS user_id
                    FROM user_notification_settings uns
                    JOIN users u ON u.user_id = uns.user_id
                    WHERE uns.digest_enabled = true
                      AND EXISTS (
                          SELECT 1 FROM user_interests ui WHERE ui.user_id = uns.user_id
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM digest_deliveries dd
                          WHERE dd.user_id = uns.user_id
                            AND dd.delivery_date = %s::date
                            AND dd.status IN ('sent', 'skipped')
                      )
                    ORDER BY uns.user_id
                    """,
                    (eff_delivery_date,),
                )
                target_user_ids = [str(r["user_id"]) for r in cur.fetchall()]

                if not target_user_ids:
                    _purge_old_deliveries(conn)
                    return {"sent": 0, "skipped": 0, "failed": 0}

                # 2. Load candidate papers published in the last 24h before run_at that have a passed short summary
                cur.execute(
                    """
                    SELECT p.id AS paper_id,
                           p.arxiv_id,
                           p.title,
                           p.abstract,
                           p.categories,
                           p.submitted_at,
                           s.json_content->>'title_ja' AS title_ja,
                           s.json_content->'thesis'->>'text' AS thesis_text
                    FROM papers p
                    JOIN paper_versions pv
                      ON pv.paper_id = p.id
                     AND pv.version = p.latest_version
                    JOIN LATERAL (
                        SELECT json_content, generated_at
                        FROM summaries
                        WHERE paper_version_id = pv.id
                          AND summary_type = 'short'
                          AND language = 'ja'
                          AND validation_status = 'passed'
                        ORDER BY generated_at DESC, id DESC
                        LIMIT 1
                    ) s ON true
                    WHERE s.generated_at >= (%s::timestamptz - INTERVAL '24 hours')
                      AND s.generated_at < %s::timestamptz
                    ORDER BY p.submitted_at DESC, p.id DESC
                    LIMIT 200
                    """,
                    (eff_run_at, eff_run_at),
                )
                candidate_papers = [dict(r) for r in cur.fetchall()]

                # 3. Resolve user emails from Supabase Auth
                email_map = fetch_user_emails_from_auth(target_user_ids)

                sent_count = 0
                skipped_count = 0
                failed_count = 0

                for uid in target_user_ids:
                    cur.execute(
                        """
                        SELECT topic, weight
                        FROM user_interests
                        WHERE user_id = %s::uuid
                        """,
                        (uid,),
                    )
                    interests = [
                        (str(r["topic"]), float(r["weight"])) for r in cur.fetchall()
                    ]
                    cur.execute(
                        """
                        SELECT paper_id
                        FROM view_events
                        WHERE user_id = %s::uuid
                        """,
                        (uid,),
                    )
                    viewed_ids = {int(r["paper_id"]) for r in cur.fetchall()}

                    scored: list[tuple[float, dict[str, Any]]] = []
                    for p in candidate_papers:
                        if int(p["paper_id"]) in viewed_ids:
                            continue
                        cats = p.get("categories") or []
                        text_lower = f"{p.get('title', '')} {p.get('abstract', '')}".lower()
                        score = 0.0
                        for topic, weight in interests:
                            if cats and topic == cats[0]:
                                score += weight * 1.0
                            elif topic in cats[1:]:
                                score += weight * 0.6
                            elif topic.lower() in text_lower:
                                score += weight * 0.4
                        if score > 0:
                            scored.append((score, p))

                    scored.sort(
                        key=lambda item: (item[0], item[1]["submitted_at"]),
                        reverse=True,
                    )
                    selected = [
                        item[1] for item in scored[: cfg.digest_max_papers_per_user]
                    ]

                    to_email = email_map.get(uid)
                    if not selected or not to_email:
                        reason = "no_matching_papers" if not selected else "no_confirmed_email"
                        _record_delivery(
                            conn, uid, eff_delivery_date, "skipped", 0, reason
                        )
                        skipped_count += 1
                        continue

                    try:
                        send_digest_email(to_email, eff_delivery_date, selected)
                        _record_delivery(
                            conn, uid, eff_delivery_date, "sent", len(selected), None
                        )
                        sent_count += 1
                    except Exception as mail_exc:
                        _record_delivery(
                            conn,
                            uid,
                            eff_delivery_date,
                            "failed",
                            len(selected),
                            sanitize_error_message(mail_exc, 500),
                        )
                        failed_count += 1

                _purge_old_deliveries(conn)

        if failed_count > 0:
            raise RuntimeError(
                f"digest_delivery failed for {failed_count} user(s) on {eff_delivery_date}"
            )
        return {"sent": sent_count, "skipped": skipped_count, "failed": 0}

    except Exception as exc:
        next_attempt = attempt + 1
        retry_args = {
            "run_at": eff_run_at,
            "delivery_date": eff_delivery_date,
            "attempt": next_attempt,
        }
        if next_attempt < cfg.job_max_attempts:
            delay = 300 if next_attempt == 1 else 900
            enqueue_job(
                queue_name="notification",
                task_name="run_digest_delivery",
                job_id=None,
                args=retry_args,
                delay_seconds=delay,
            )
        else:
            push_failure_entry(
                job_type="digest_delivery",
                job_id=None,
                args={"run_at": eff_run_at, "delivery_date": eff_delivery_date},
            )
        raise


def _record_delivery(
    conn: Any,
    user_id: str,
    delivery_date: str,
    status: str,
    paper_count: int,
    error_reason: str | None,
) -> None:
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO digest_deliveries (
                    user_id, delivery_date, status, paper_count, error_reason
                )
                VALUES (%s::uuid, %s::date, %s, %s, %s)
                ON CONFLICT (user_id, delivery_date, status)
                DO UPDATE SET
                    delivered_at = CURRENT_TIMESTAMP,
                    paper_count = EXCLUDED.paper_count,
                    error_reason = EXCLUDED.error_reason
                """,
                (user_id, delivery_date, status, paper_count, error_reason),
            )


def _purge_old_deliveries(conn: Any) -> int:
    """BT.B007 DA006: Delete digest_deliveries older than 90 days."""
    with transaction(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM digest_deliveries
                WHERE delivered_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
                """
            )
            return cur.rowcount or 0
