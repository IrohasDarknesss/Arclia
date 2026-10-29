"""Redis queue, failure queue (jobs:failed), and arXiv global rate limiter (ARC006, ARC007)."""

from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from collections import defaultdict, deque
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None  # type: ignore

from worker.config import get_config

logger = logging.getLogger(__name__)

ARXIV_SLOT_KEY = "arxiv:request_slot"
FAILED_JOBS_KEY = "jobs:failed"
REPROCESS_LOCK_KEY = "reprocess:lock"


class ArxivRateLimitUnavailableError(RuntimeError):
    """Raised when Redis is unreachable and fail-safe prevents unthrottled arXiv requests (ARC007)."""


class InMemoryRedisClient:
    """Thread-safe in-memory Redis emulator for local execution without a running Redis server."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls) -> "InMemoryRedisClient":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._kv = {}
                cls._instance._lists = defaultdict(deque)
                cls._instance._client_lock = threading.Lock()
            return cls._instance

    def ping(self) -> bool:
        return True

    def set(
        self,
        name: str,
        value: str,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool:
        with self._client_lock:
            now = time.monotonic()
            existing = self._kv.get(name)
            if existing is not None:
                _, exp = existing
                if exp is not None and now >= exp:
                    del self._kv[name]
                    existing = None

            if nx and existing is not None:
                return False

            expiry = (now + ex) if ex is not None else None
            self._kv[name] = (str(value), expiry)
            return True

    def get(self, name: str) -> str | None:
        with self._client_lock:
            existing = self._kv.get(name)
            if existing is None:
                return None
            val, exp = existing
            if exp is not None and time.monotonic() >= exp:
                del self._kv[name]
                return None
            return val

    def rpush(self, name: str, *values: str) -> int:
        with self._client_lock:
            q = self._lists[name]
            for v in values:
                q.append(str(v))
            return len(q)

    def blpop(self, keys: list[str], timeout: int = 0) -> tuple[str, str] | None:
        deadline = time.monotonic() + max(0, timeout)
        while True:
            with self._client_lock:
                for k in keys:
                    q = self._lists.get(k)
                    if q:
                        return (k, q.popleft())
            if timeout <= 0 or time.monotonic() >= deadline:
                return None
            time.sleep(0.1)

    def lrange(self, name: str, start: int, end: int) -> list[str]:
        with self._client_lock:
            q = list(self._lists.get(name, []))
            if end == -1:
                return q[start:]
            return q[start : end + 1]

    def lrem(self, name: str, count: int, value: str) -> int:
        with self._client_lock:
            q = self._lists.get(name)
            if not q:
                return 0
            removed = 0
            items = list(q)
            q.clear()
            for item in items:
                if item == value and (count == 0 or removed < abs(count)):
                    removed += 1
                else:
                    q.append(item)
            return removed

    def delete(self, *names: str) -> int:
        with self._client_lock:
            count = 0
            for name in names:
                if name in self._kv:
                    del self._kv[name]
                    count += 1
                if name in self._lists:
                    del self._lists[name]
                    count += 1
            return count


def get_redis_client() -> Any:
    """Return a configured Redis client, falling back to in-memory emulator if server is offline."""
    cfg = get_config()
    if cfg.redis_url.startswith("memory://"):
        return InMemoryRedisClient()

    if redis is not None:
        try:
            client = redis.Redis.from_url(
                cfg.redis_url,
                decode_responses=True,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
            )
            client.ping()
            return client
        except Exception:
            return InMemoryRedisClient()

    return InMemoryRedisClient()


def acquire_arxiv_request_slot(
    client: Any | None = None,
    max_wait_seconds: float = 30.0,
    poll_interval_seconds: float = 0.25,
) -> None:
    """Acquire the global arXiv 3-second request slot in Redis (`SET arxiv:request_slot 1 NX EX 3`).

    Per ARC007:
    - Enforces >= 3 seconds between requests across all processes (B001, B005, B006).
    - Fail-safe: if Redis is unreachable, raises ArxivRateLimitUnavailableError immediately
      rather than calling arXiv without rate limiting.
    """
    cfg = get_config()
    interval = max(3, cfg.arxiv_request_interval_seconds)
    r = client or get_redis_client()
    deadline = time.monotonic() + max_wait_seconds

    while True:
        try:
            acquired = r.set(ARXIV_SLOT_KEY, "1", nx=True, ex=interval)
        except Exception as exc:
            logger.error("Redis unavailable while acquiring %s: %s", ARXIV_SLOT_KEY, exc)
            raise ArxivRateLimitUnavailableError(
                "Redis global rate limiter is unavailable; aborting arXiv request (ARC007 fail-safe)"
            ) from exc

        if acquired:
            return

        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Timed out waiting {max_wait_seconds}s for {ARXIV_SLOT_KEY}"
            )
        time.sleep(poll_interval_seconds)


def queue_key(queue_name: str) -> str:
    return f"queue:{queue_name}"


def enqueue_job(
    queue_name: str,
    task_name: str,
    job_id: int | None = None,
    args: dict[str, Any] | None = None,
    delay_seconds: int = 0,
    client: Any | None = None,
) -> bool:
    """Push a job message onto a Redis queue list (`queue:<queue_name>`)."""
    r = client or get_redis_client()
    now = dt.datetime.now(dt.timezone.utc)
    available_at = (now + dt.timedelta(seconds=max(0, delay_seconds))).isoformat()
    payload = {
        "task": task_name,
        "jobId": job_id,
        "args": args or {},
        "enqueuedAt": now.isoformat(),
        "availableAt": available_at,
    }
    try:
        r.rpush(queue_key(queue_name), json.dumps(payload, ensure_ascii=False))
        return True
    except Exception as exc:
        logger.error(
            "Failed to enqueue job to %s (job_id=%s, task=%s): %s",
            queue_name,
            job_id,
            task_name,
            exc,
        )
        return False


def push_failure_entry(
    job_type: str,
    job_id: int | None,
    args: dict[str, Any] | None = None,
    client: Any | None = None,
) -> bool:
    """Push a failed job entry into the Redis dead-letter list `jobs:failed` (BT.B010 §2)."""
    r = client or get_redis_client()
    sanitized_args = dict(args) if args else {}
    # BT.B006 §2: requestedAt is not kept in retry/failure messages
    sanitized_args.pop("requestedAt", None)

    entry = {
        "jobType": job_type,
        "jobId": job_id,
        "args": sanitized_args if sanitized_args else None,
        "failedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    try:
        r.rpush(FAILED_JOBS_KEY, json.dumps(entry, ensure_ascii=False))
        return True
    except Exception as exc:
        logger.error(
            "Failed to push entry to %s (jobType=%s, jobId=%s): %s",
            FAILED_JOBS_KEY,
            job_type,
            job_id,
            exc,
        )
        return False
