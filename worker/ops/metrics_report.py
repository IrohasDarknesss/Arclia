"""F19: Cost and Operational Metrics Report CLI (`python -m worker.ops.metrics_report`, BE.F19)."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from typing import Any

from worker.db import get_connection


def validate_report_params(
    from_date: str | None,
    to_date: str | None,
    limit: int = 20,
    fmt: str = "table",
) -> tuple[dt.datetime, dt.datetime, int, str]:
    """BE.F19 FN02: Validate date range (<=366 days), limit (1..100), and format ('table'|'json')."""
    today = dt.datetime.now(dt.timezone.utc).date()
    d_to = dt.date.fromisoformat(to_date) if to_date else today
    d_from = (
        dt.date.fromisoformat(from_date)
        if from_date
        else (d_to - dt.timedelta(days=6))
    )

    if d_from > d_to:
        raise ValueError("--from must be earlier than or equal to --to")
    if (d_to - d_from).days > 366:
        raise ValueError("Date range cannot exceed 366 days")
    if not (1 <= limit <= 100):
        raise ValueError("--limit must be between 1 and 100")
    if fmt not in ("table", "json"):
        raise ValueError("--format must be 'table' or 'json'")

    start_utc = dt.datetime.combine(d_from, dt.time(0, 0, 0), tzinfo=dt.timezone.utc)
    end_utc = dt.datetime.combine(
        d_to + dt.timedelta(days=1), dt.time(0, 0, 0), tzinfo=dt.timezone.utc
    )
    return start_utc, end_utc, limit, fmt


def collect_metrics(
    start_utc: dt.datetime,
    end_utc: dt.datetime,
    limit: int = 20,
) -> dict[str, Any]:
    """BE.F19 DA001 - DA005: Collect summary generation, latency, job status, failed jobs, and active job counts."""
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            # DA001: Summary generation count & pass/fail breakdown by date, type, model
            cur.execute(
                """
                SELECT (s.generated_at AT TIME ZONE 'UTC')::date::text          AS report_date,
                       s.summary_type,
                       s.source_scope,
                       s.model_id,
                       COUNT(*)::int                                            AS total_count,
                       COUNT(*) FILTER (WHERE s.validation_status = 'passed')::int  AS passed_count,
                       COUNT(*) FILTER (WHERE s.validation_status = 'failed')::int  AS failed_count,
                       COUNT(*) FILTER (WHERE s.validation_status = 'pending')::int AS pending_count,
                       ROUND(
                         100.0 * COUNT(*) FILTER (WHERE s.validation_status = 'passed')
                         / NULLIF(COUNT(*) FILTER (WHERE s.validation_status IN ('passed', 'failed')), 0),
                         1
                       )::float                                                 AS pass_rate_pct
                FROM   summaries s
                WHERE  s.generated_at >= %s
                  AND  s.generated_at <  %s
                GROUP BY 1, 2, 3, 4
                ORDER BY 1 DESC, 2, 4
                """,
                (start_utc, end_utc),
            )
            summary_stats = [dict(r) for r in cur.fetchall()]

            # DA002: Publication latency (fetched_at -> first passed short/standard summary)
            cur.execute(
                """
                WITH first_passed AS (
                  SELECT pv.id AS paper_version_id,
                         (pv.metadata_snapshot->>'fetched_at')::timestamptz AS fetched_at,
                         MIN(s.generated_at) AS first_published_at
                  FROM   paper_versions pv
                  JOIN   summaries s
                    ON   s.paper_version_id = pv.id
                   AND   s.summary_type IN ('short', 'standard')
                   AND   s.validation_status = 'passed'
                  WHERE  pv.metadata_snapshot ? 'fetched_at'
                    AND  (pv.metadata_snapshot->>'fetched_at')::timestamptz >= %s
                    AND  (pv.metadata_snapshot->>'fetched_at')::timestamptz <  %s
                  GROUP BY pv.id, pv.metadata_snapshot
                )
                SELECT COUNT(*)::int AS version_count,
                       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
                         ORDER BY EXTRACT(EPOCH FROM (first_published_at - fetched_at)) / 60.0
                       ))::numeric, 1)::float AS median_minutes,
                       ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (
                         ORDER BY EXTRACT(EPOCH FROM (first_published_at - fetched_at)) / 60.0
                       ))::numeric, 1)::float AS p90_minutes,
                       ROUND((MAX(
                         EXTRACT(EPOCH FROM (first_published_at - fetched_at)) / 60.0
                       ))::numeric, 1)::float AS max_minutes
                FROM   first_passed
                WHERE  first_published_at >= fetched_at
                """,
                (start_utc, end_utc),
            )
            latency_row = cur.fetchone()
            latency_stats = dict(latency_row) if latency_row else {}

            # DA003: Job status and retry breakdown by job_type
            cur.execute(
                """
                SELECT j.job_type,
                       j.status,
                       COUNT(*)::int                                    AS job_count,
                       COUNT(*) FILTER (WHERE j.attempts >= 1)::int     AS retried_count,
                       COALESCE(MAX(j.attempts), 0)::int                AS max_attempts
                FROM   jobs j
                GROUP BY j.job_type, j.status
                ORDER BY j.job_type, j.status
                """
            )
            job_breakdown = [dict(r) for r in cur.fetchall()]

            # DA004: Recent failed jobs
            cur.execute(
                """
                SELECT j.id               AS job_id,
                       j.job_type,
                       j.paper_version_id,
                       p.arxiv_id,
                       pv.version,
                       j.attempts,
                       LEFT(j.last_error, 200) AS last_error_excerpt
                FROM   jobs j
                LEFT JOIN paper_versions pv ON pv.id = j.paper_version_id
                LEFT JOIN papers p          ON p.id  = pv.paper_id
                WHERE  j.status = 'failed'
                ORDER BY j.id DESC
                LIMIT  %s
                """,
                (limit,),
            )
            failed_jobs = [dict(r) for r in cur.fetchall()]

            # DA005: Active (pending / running) job counts
            cur.execute(
                """
                SELECT j.status,
                       j.job_type,
                       COUNT(*)::int AS active_count,
                       MIN(j.id)     AS oldest_job_id
                FROM   jobs j
                WHERE  j.status IN ('pending', 'running')
                GROUP BY j.status, j.job_type
                ORDER BY j.status, j.job_type
                """
            )
            active_jobs = [dict(r) for r in cur.fetchall()]

    return {
        "period": {
            "from": start_utc.strftime("%Y-%m-%d"),
            "to": (end_utc - dt.timedelta(days=1)).strftime("%Y-%m-%d"),
        },
        "summary_generation": summary_stats,
        "publication_latency": latency_stats,
        "job_breakdown": job_breakdown,
        "failed_jobs": failed_jobs,
        "active_jobs": active_jobs,
    }


def format_report(report: dict[str, Any], fmt: str) -> str:
    """BE.F19 FN03: Render the metrics report as JSON or human-readable table."""
    if fmt == "json":
        return json.dumps(report, ensure_ascii=False, indent=2)

    lines = [
        f"=== Arclia 運用・コストメトリクスレポート ({report['period']['from']} 〜 {report['period']['to']}) ===",
        "",
        "[1] 要約生成件数・検証合格率 (DA001)",
    ]
    if not report["summary_generation"]:
        lines.append("  (対象期間の生成実績なし)")
    else:
        for r in report["summary_generation"]:
            lines.append(
                f"  {r['report_date']} | {r['summary_type']} ({r['source_scope']}) | model={r['model_id']} "
                f"| total={r['total_count']} passed={r['passed_count']} failed={r['failed_count']} "
                f"pass_rate={r['pass_rate_pct']}%"
            )

    lat = report.get("publication_latency") or {}
    lines.extend(
        [
            "",
            "[2] 新着論文から日本語速報公開までの時間 (DA002)",
            f"  対象版数={lat.get('version_count', 0)} | 中央値={lat.get('median_minutes')}分 "
            f"| 90パーセンタイル={lat.get('p90_minutes')}分 | 最大={lat.get('max_minutes')}分",
            "",
            "[3] ジョブ種別・状態ごとの件数 (DA003)",
        ]
    )
    for r in report["job_breakdown"]:
        lines.append(
            f"  {r['job_type']} [{r['status']}]: {r['job_count']}件 (再試行あり={r['retried_count']}, 最大試行={r['max_attempts']})"
        )

    lines.append("")
    lines.append("[4] 待機中・実行中ジョブの滞留件数 (DA005)")
    if not report["active_jobs"]:
        lines.append("  (滞留なし)")
    else:
        for r in report["active_jobs"]:
            lines.append(
                f"  [{r['status']}] {r['job_type']}: {r['active_count']}件 (最古job_id={r['oldest_job_id']})"
            )

    lines.append("")
    lines.append("[5] 直近の失敗ジョブ一覧 (DA004)")
    if not report["failed_jobs"]:
        lines.append("  (失敗ジョブなし)")
    else:
        for r in report["failed_jobs"]:
            lines.append(
                f"  job_id={r['job_id']} type={r['job_type']} arxiv={r.get('arxiv_id')}v{r.get('version')} "
                f"attempts={r['attempts']} error={r.get('last_error_excerpt')}"
            )

    return "\n".join(lines)


def run_metrics_report(
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 20,
    fmt: str = "table",
) -> dict[str, Any]:
    """BE.F19 FN01: Main entrypoint for the operational metrics report."""
    start_utc, end_utc, eff_limit, eff_fmt = validate_report_params(
        from_date, to_date, limit, fmt
    )
    data = collect_metrics(start_utc, end_utc, eff_limit)
    print(format_report(data, eff_fmt))
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="F19 コスト管理・運用メトリクス集計 CLI")
    parser.add_argument("--from", dest="from_date", type=str, default=None, help="集計開始日 (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", type=str, default=None, help="集計終了日 (YYYY-MM-DD)")
    parser.add_argument("--limit", type=int, default=20, help="失敗ジョブ表示件数上限 (1..100)")
    parser.add_argument("--format", dest="fmt", type=str, default="table", help="出力形式 (table | json)")

    args = parser.parse_args()
    try:
        run_metrics_report(
            from_date=args.from_date,
            to_date=args.to_date,
            limit=args.limit,
            fmt=args.fmt,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
