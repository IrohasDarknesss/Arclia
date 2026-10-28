"""Main entrypoint for the Arclia asynchronous worker loop and health/scheduler FastAPI app."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import time
from typing import Any

from fastapi import FastAPI

from worker.config import get_config
from worker.jobs.analyze_full_text import (
    analyze_full_text,
    enqueue_daily_full_text_candidates,
)
from worker.jobs.collect_metadata import (
    register_and_enqueue_collect_metadata,
    run_collect_metadata,
)
from worker.jobs.digest_delivery import run_digest_delivery
from worker.jobs.generate_embedding import generate_embedding
from worker.jobs.link_github import enqueue_daily_github_candidates, link_github
from worker.jobs.publish_summary import publish_summary
from worker.jobs.runner import JobRunner
from worker.jobs.summarize_abstract import summarize_abstract
from worker.jobs.sync_on_demand import run_sync_on_demand
from worker.jobs.update_search_index import update_search_index
from worker.jobs.validate_summary import validate_summary
from worker.jobs.view_events_retention import run_view_events_retention
from worker.redis_client import get_redis_client, queue_key

logger = logging.getLogger(__name__)

VERSION_JOB_HANDLERS = {
    "summarize_abstract": summarize_abstract,
    "validate_summary": validate_summary,
    "publish_summary": publish_summary,
    "analyze_full_text": analyze_full_text,
    "generate_embedding": generate_embedding,
    "link_github": link_github,
    "update_search_index": update_search_index,
}

ALL_QUEUES = [
    "sync_on_demand",
    "summarize",
    "default",
    "fulltext",
    "embedding",
    "github",
    "notification",
]

app = FastAPI(title="Arclia Worker Internal Service", version="0.1.0")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


def dispatch_queue_message(payload: dict[str, Any]) -> str:
    """Dispatch a single decoded queue message to its corresponding batch handler."""
    task = payload.get("task")
    job_id = payload.get("jobId")
    args = payload.get("args") or {}

    if task == "run_collect_metadata" and job_id is not None:
        run_collect_metadata(
            int(job_id),
            window_from=args.get("window_from"),
            window_to=args.get("window_to"),
        )
        return "collect_metadata"

    if task == "run_sync_on_demand" and job_id is not None:
        run_sync_on_demand(
            int(job_id),
            q=args.get("q"),
            category=args.get("category"),
        )
        return "sync_on_demand"

    if task == "run_digest_delivery":
        run_digest_delivery(
            run_at=args.get("run_at"),
            delivery_date=args.get("delivery_date"),
            attempt=int(args.get("attempt") or 0),
        )
        return "digest_delivery"

    if task == "run" and job_id is not None:
        job_type = str(args.get("jobType") or "")
        handler = VERSION_JOB_HANDLERS.get(job_type)
        if handler is None:
            raise ValueError(f"Unknown handler for jobType='{job_type}'")
        runner = JobRunner()
        return runner.run(int(job_id), handler, extra_args=args)

    raise ValueError(f"Unsupported queue task payload: {payload}")


def run_worker_loop(queues: list[str] | None = None, poll_timeout: int = 2) -> None:
    """Continuously poll Redis queues and execute ready jobs."""
    cfg = get_config()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    target_queues = [queue_key(q) for q in (queues or ALL_QUEUES)]
    r = get_redis_client()
    logger.info("Arclia worker listening on queues: %s", target_queues)

    while True:
        item = r.blpop(target_queues, timeout=poll_timeout)
        if not item:
            continue
        q_key, raw_msg = item
        try:
            payload = json.loads(raw_msg)
        except Exception:
            logger.error("Discarding invalid JSON on queue %s: %s", q_key, raw_msg)
            continue

        available_at_str = payload.get("availableAt")
        if available_at_str:
            try:
                avail_dt = dt.datetime.fromisoformat(available_at_str)
                now_utc = dt.datetime.now(dt.timezone.utc)
                if avail_dt > now_utc:
                    # Re-queue delayed message and pause briefly
                    r.rpush(q_key, raw_msg)
                    time.sleep(0.5)
                    continue
            except ValueError:
                pass

        try:
            dispatch_queue_message(payload)
        except Exception as exc:
            logger.exception("Unhandled error dispatching message from %s: %s", q_key, exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Arclia Python Worker & Scheduler")
    parser.add_argument(
        "--queues",
        type=str,
        default=None,
        help="Comma-separated queue names to subscribe to",
    )
    parser.add_argument(
        "--schedule",
        choices=[
            "collect_metadata",
            "analyze_full_text",
            "link_github",
            "digest_delivery",
            "view_events_retention",
        ],
        default=None,
        help="Trigger a scheduled daily batch job once and exit",
    )
    args = parser.parse_args()

    if args.schedule == "collect_metadata":
        register_and_enqueue_collect_metadata()
    elif args.schedule == "analyze_full_text":
        enqueue_daily_full_text_candidates()
    elif args.schedule == "link_github":
        enqueue_daily_github_candidates()
    elif args.schedule == "digest_delivery":
        run_digest_delivery()
    elif args.schedule == "view_events_retention":
        run_view_events_retention()
    else:
        q_list = (
            [q.strip() for q in args.queues.split(",") if q.strip()]
            if args.queues
            else None
        )
        run_worker_loop(queues=q_list)


if __name__ == "__main__":
    main()
