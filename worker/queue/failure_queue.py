"""Failure queue reader and remover for B010 (`jobs:failed` in Redis)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from worker.redis_client import FAILED_JOBS_KEY, get_redis_client

logger = logging.getLogger(__name__)


@dataclass
class FailureQueueIndex:
    by_job_id: dict[int, dict[str, Any]] = field(default_factory=dict)
    queue_only_entries: list[dict[str, Any]] = field(default_factory=list)


def load_failure_entries(client: Any | None = None) -> FailureQueueIndex:
    """BT.B010 §4 `load_failure_entries`: Read all items from Redis `jobs:failed`."""
    r = client or get_redis_client()
    raw_items = r.lrange(FAILED_JOBS_KEY, 0, -1) or []
    index = FailureQueueIndex()

    for raw in raw_items:
        try:
            parsed = json.loads(raw)
        except Exception:
            logger.warning("Skipping malformed JSON entry in %s", FAILED_JOBS_KEY)
            continue

        if not isinstance(parsed, dict) or not parsed.get("jobType") or not parsed.get("failedAt"):
            logger.warning(
                "Skipping entry missing jobType or failedAt in %s", FAILED_JOBS_KEY
            )
            continue

        parsed["_raw"] = raw
        job_id = parsed.get("jobId")
        if isinstance(job_id, int):
            existing = index.by_job_id.get(job_id)
            if existing is None or str(parsed["failedAt"]) >= str(existing["failedAt"]):
                index.by_job_id[job_id] = parsed
        else:
            index.queue_only_entries.append(parsed)

    return index


def remove_failure_entry(entry: dict[str, Any] | None, client: Any | None = None) -> None:
    """BT.B010 §4 `remove_failure_entry`: Remove a processed entry from `jobs:failed`."""
    if not entry:
        return
    raw = entry.get("_raw")
    if not raw:
        return
    r = client or get_redis_client()
    r.lrem(FAILED_JOBS_KEY, 0, raw)
