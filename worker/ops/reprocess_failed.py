"""B010: Failed job reprocessing CLI (`python -m worker.ops.reprocess_failed`, BT.B010)."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
from typing import Any

from worker.config import get_config
from worker.jobs.routes import ROUTE_TABLE, JobRoute, resolve_route
from worker.queue.failure_queue import load_failure_entries, remove_failure_entry
from worker.redis_client import REPROCESS_LOCK_KEY, enqueue_job, get_redis_client
from worker.repositories.reprocess_repository import (
    DuplicateActiveJobError,
    ReprocessRepository,
)

logger = logging.getLogger(__name__)
JST = dt.timezone(dt.timedelta(hours=9))


def requeue(
    route: JobRoute,
    job_id: int | None,
    args: dict[str, Any] | None = None,
    redis_client: Any | None = None,
) -> bool:
    """BT.B010 §4 `requeue`: Enqueue a job back onto its designated queue without delay."""
    payload_args: dict[str, Any] = {"jobType": route.job_type}
    if args:
        if route.job_type == "sync_on_demand":
            # BT.B006 §2: pass only jobId, q, category (omit requestedAt)
            payload_args.update(
                {
                    "jobId": job_id,
                    "q": args.get("q"),
                    "category": args.get("category"),
                }
            )
        elif route.job_type == "digest_delivery":
            payload_args.update(
                {
                    "run_at": args.get("run_at"),
                    "delivery_date": args.get("delivery_date"),
                    "attempt": 0,
                }
            )
        else:
            payload_args.update(args)

    return enqueue_job(
        queue_name=route.queue,
        task_name=route.task,
        job_id=job_id,
        args=payload_args,
        delay_seconds=0,
        client=redis_client,
    )


def show_failed_jobs(
    job_type: str | None = None,
    ids: list[int] | None = None,
    limit: int = 1000,
    repo: ReprocessRepository | None = None,
    redis_client: Any | None = None,
) -> int:
    """BT.B010 §4 `show_failed_jobs`: Print summary counts and detailed failed jobs list."""
    r_repo = repo or ReprocessRepository()
    counts = r_repo.count_failed_by_job_type()
    fq_index = load_failure_entries(client=redis_client)

    print("=== 種別ごとの失敗件数 (jobs.status = 'failed') ===")
    if not counts:
        print("  (0件)")
    else:
        for row in counts:
            print(f"  {row['job_type']}: {row['failed_count']}件")

    displayed = 0
    if job_type != "digest_delivery":
        jobs = r_repo.list_failed_jobs(job_type=job_type, ids=ids, limit=limit)
        print(f"\n=== 失敗ジョブ一覧 (表示上限: {limit}件) ===")
        for j in jobs:
            jid = int(j["id"])
            jtype = str(j["job_type"])
            route = resolve_route(jtype)
            entry = fq_index.by_job_id.get(jid)
            has_args = bool(entry and entry.get("args"))
            failed_at = entry.get("failedAt") if entry else "-"
            arg_status = (
                "引数あり"
                if has_args
                else ("引数なし(要確認)" if route.needs_args else "引数不要")
            )
            err_preview = (str(j.get("last_error") or ""))[:200]
            print(
                f"  id={jid} type={jtype} version={j.get('paper_version_id')} "
                f"attempts={j['attempts']} failedAt={failed_at} [{arg_status}] error={err_preview}"
            )
            displayed += 1

    if job_type in (None, "digest_delivery") and not ids:
        b007_entries = [
            e
            for e in fq_index.queue_only_entries
            if e.get("jobType") == "digest_delivery"
        ]
        if b007_entries:
            print("\n=== 失敗キューのみの項目 (digest_delivery / B007) ===")
            for e in b007_entries:
                eargs = e.get("args") or {}
                print(
                    f"  type=digest_delivery delivery_date={eargs.get('delivery_date')} "
                    f"failedAt={e.get('failedAt')}"
                )
                displayed += 1

    return displayed


def reprocess_failed_job(
    job: dict[str, Any],
    entry: dict[str, Any] | None,
    repo: ReprocessRepository | None = None,
    redis_client: Any | None = None,
) -> str:
    """BT.B010 §4 `reprocess_failed_job`: Reset one failed job to pending and requeue it."""
    r_repo = repo or ReprocessRepository()
    job_id = int(job["id"])
    job_type = str(job["job_type"])
    route = resolve_route(job_type)
    entry_args = (entry or {}).get("args")

    if route.needs_args and not entry_args:
        if route.on_missing_args == "skip_reprocess":
            logger.info(
                "Skipped job %s (%s): missing required arguments in jobs:failed",
                job_id,
                job_type,
            )
            return "skipped_missing_args"

    try:
        updated = r_repo.reset_failed_to_pending(job_id)
    except DuplicateActiveJobError:
        logger.info(
            "Skipped job %s (%s): duplicate active job for same version",
            job_id,
            job_type,
        )
        return "skipped_duplicate"

    if updated is None:
        return "skipped_already_changed"

    if requeue(route, job_id=job_id, args=entry_args, redis_client=redis_client):
        remove_failure_entry(entry, client=redis_client)
        logger.info("Reprocessed failed job %s (%s)", job_id, job_type)
        return "reprocessed"
    else:
        r_repo.revert_pending_to_failed(job_id)
        logger.error(
            "Requeue failed for job %s (%s); reverted status back to failed",
            job_id,
            job_type,
        )
        return "requeue_failed"


def recover_running_job(
    job_id: int,
    entry: dict[str, Any] | None,
    repo: ReprocessRepository | None = None,
    redis_client: Any | None = None,
) -> str:
    """BT.B010 §4 `recover_running_job`: Reset a stuck running job to pending and requeue it."""
    r_repo = repo or ReprocessRepository()
    updated = r_repo.reset_running_to_pending(job_id)
    if updated is None:
        return "not_running"

    job_type = str(updated["job_type"])
    route = resolve_route(job_type)
    entry_args = (entry or {}).get("args")

    if requeue(route, job_id=job_id, args=entry_args, redis_client=redis_client):
        logger.warning("Recovered stuck running job %s (%s)", job_id, job_type)
        return "reprocessed"
    else:
        logger.error(
            "Failed to enqueue recovered running job %s (%s); use --requeue-pending %s",
            job_id,
            job_type,
            job_id,
        )
        return "requeue_failed"


def requeue_pending_job(
    job_id: int,
    repo: ReprocessRepository | None = None,
    redis_client: Any | None = None,
) -> str:
    """BT.B010 §4 `requeue_pending_job`: Re-enqueue a job that is already in pending status."""
    r_repo = repo or ReprocessRepository()
    pending_rows = r_repo.find_pending_jobs([job_id])
    if not pending_rows:
        return "not_pending"

    row = pending_rows[0]
    job_type = str(row["job_type"])
    route = resolve_route(job_type)
    if requeue(route, job_id=job_id, args=None, redis_client=redis_client):
        logger.info("Requeued pending job %s (%s)", job_id, job_type)
        return "reprocessed"
    else:
        logger.error("Failed to requeue pending job %s (%s)", job_id, job_type)
        return "requeue_failed"


def reprocess_queue_only_entry(
    entry: dict[str, Any],
    redis_client: Any | None = None,
) -> str:
    """BT.B010 §4 `reprocess_queue_only_entry`: Reprocess a queue-only B007 `digest_delivery` entry."""
    eargs = entry.get("args") or {}
    delivery_date = eargs.get("delivery_date")
    today_jst = dt.datetime.now(dt.timezone.utc).astimezone(JST).strftime("%Y-%m-%d")

    if not delivery_date or str(delivery_date) != today_jst:
        remove_failure_entry(entry, client=redis_client)
        logger.info(
            "Removed stale digest_delivery failure entry (delivery_date=%s != today=%s)",
            delivery_date,
            today_jst,
        )
        return "expired_removed"

    route = resolve_route("digest_delivery")
    if requeue(route, job_id=None, args=eargs, redis_client=redis_client):
        remove_failure_entry(entry, client=redis_client)
        return "reprocessed"
    return "requeue_failed"


def run_reprocess(
    list_only: bool = False,
    job_type: str | None = None,
    ids: list[int] | None = None,
    all_failed: bool = False,
    recover_running: list[int] | None = None,
    requeue_pending: list[int] | None = None,
    execute: bool = False,
    limit: int | None = None,
) -> dict[str, int]:
    """BT.B010 §4 `run_reprocess`: Main entrypoint for B010 failed job reprocessing."""
    cfg = get_config()
    eff_limit = limit if (limit is not None and limit > 0) else cfg.reprocess_max_per_run

    ops_chosen = sum(
        bool(x)
        for x in (list_only, ids, all_failed, recover_running, requeue_pending)
    )
    if ops_chosen != 1:
        raise ValueError(
            "Specify exactly one operation: --list, --ids, --all-failed, --recover-running, or --requeue-pending"
        )
    if all_failed and not job_type:
        raise ValueError("--all-failed requires --job-type to be specified")
    if job_type and job_type not in ROUTE_TABLE:
        raise ValueError(
            f"Unknown --job-type '{job_type}'. Valid types: {sorted(ROUTE_TABLE.keys())}"
        )

    if list_only:
        count = show_failed_jobs(job_type=job_type, ids=ids, limit=eff_limit)
        return {"listed": count}

    r = get_redis_client()
    if not r.set(REPROCESS_LOCK_KEY, "1", nx=True, ex=1800):
        print("他の運用者が再処理中 (reprocess:lock exists)")
        return {"locked": 1}

    summary = {
        "reprocessed": 0,
        "skipped_duplicate": 0,
        "skipped_missing_args": 0,
        "skipped_already_changed": 0,
        "requeue_failed": 0,
        "dry_run": 0,
    }
    repo = ReprocessRepository()

    try:
        fq_index = (
            load_failure_entries(client=r) if not requeue_pending else None
        )

        if recover_running:
            for jid in recover_running[:eff_limit]:
                if not execute:
                    print(f"[DRY-RUN] recover_running job_id={jid}")
                    summary["dry_run"] += 1
                else:
                    entry = fq_index.by_job_id.get(jid) if fq_index else None
                    res = recover_running_job(jid, entry, repo=repo, redis_client=r)
                    summary[res] = summary.get(res, 0) + 1

        elif requeue_pending:
            for jid in requeue_pending[:eff_limit]:
                if not execute:
                    print(f"[DRY-RUN] requeue_pending job_id={jid}")
                    summary["dry_run"] += 1
                else:
                    res = requeue_pending_job(jid, repo=repo, redis_client=r)
                    summary[res] = summary.get(res, 0) + 1

        elif job_type == "digest_delivery":
            entries = [
                e
                for e in (fq_index.queue_only_entries if fq_index else [])
                if e.get("jobType") == "digest_delivery"
            ]
            for e in entries[:eff_limit]:
                if not execute:
                    print(
                        f"[DRY-RUN] reprocess digest_delivery delivery_date={(e.get('args') or {}).get('delivery_date')}"
                    )
                    summary["dry_run"] += 1
                else:
                    res = reprocess_queue_only_entry(e, redis_client=r)
                    summary[res] = summary.get(res, 0) + 1

        else:
            targets = repo.list_failed_jobs(
                job_type=job_type, ids=ids, limit=eff_limit
            )
            for job in targets:
                jid = int(job["id"])
                entry = fq_index.by_job_id.get(jid) if fq_index else None
                if not execute:
                    print(
                        f"[DRY-RUN] reprocess job_id={jid} type={job['job_type']} version={job.get('paper_version_id')}"
                    )
                    summary["dry_run"] += 1
                else:
                    res = reprocess_failed_job(
                        job, entry, repo=repo, redis_client=r
                    )
                    summary[res] = summary.get(res, 0) + 1

        print(json.dumps(summary, ensure_ascii=False))
        return summary
    finally:
        r.delete(REPROCESS_LOCK_KEY)


def _parse_ids(val: str | None) -> list[int] | None:
    if not val:
        return None
    return [int(x.strip()) for x in val.split(",") if x.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="B010 失敗ジョブの再処理 CLI")
    parser.add_argument("--list", action="store_true", help="失敗ジョブの一覧と件数を表示")
    parser.add_argument("--job-type", type=str, default=None, help="対象のジョブ種別")
    parser.add_argument("--ids", type=str, default=None, help="カンマ区切りのジョブID一覧")
    parser.add_argument("--all-failed", action="store_true", help="指定種別の全失敗ジョブを対象にする")
    parser.add_argument("--recover-running", type=str, default=None, help="実行中のまま止まったジョブID一覧")
    parser.add_argument("--requeue-pending", type=str, default=None, help="待機のまま投入されなかったジョブID一覧")
    parser.add_argument("--execute", action="store_true", help="実際に更新・再投入を行う（指定なしは試し実行）")
    parser.add_argument("--limit", type=int, default=None, help="1回で戻す上限件数")

    args = parser.parse_args()
    try:
        run_reprocess(
            list_only=args.list,
            job_type=args.job_type,
            ids=_parse_ids(args.ids),
            all_failed=args.all_failed,
            recover_running=_parse_ids(args.recover_running),
            requeue_pending=_parse_ids(args.requeue_pending),
            execute=args.execute,
            limit=args.limit,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
