"""Bounded, process-local jobs. Restart loses results by design; never stores a plan master."""
import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .errors import AppError, public_error

logger = logging.getLogger("tripflow")
TERMINAL = {"SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    return value


def digest(value):
    return hashlib.sha256(json.dumps(dump(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


@dataclass
class Job:
    job_id: str
    request_id: str
    trace_id: str
    context: dict
    status: str = "PENDING"
    result: Any = None
    errors: list = field(default_factory=list)
    events: list = field(default_factory=list)
    created: float = field(default_factory=time.monotonic)
    finished: float | None = None
    task: asyncio.Task | None = None

    def emit(self, agent_id, event_type, message, run_id, tool_name=None):
        if self.status in TERMINAL:
            return
        event = {"eventId": uuid.uuid4().hex, "sequence": len(self.events) + 1, "occurredAt": now_iso(),
                 "runId": run_id, "agentId": agent_id, "type": event_type,
                 "message": message, "traceId": self.trace_id}
        if tool_name:
            event["toolName"] = tool_name
        self.events.append(event)

    def accepted(self):
        return {**self.context, "jobId": self.job_id}

    def snapshot(self, after=0):
        if after < 0 or after > len(self.events):
            raise AppError("VALIDATION_ERROR", "afterSequence 超出已产生的事件范围。", field_path="afterSequence")
        data = {**self.accepted(), "status": self.status, "progressEvents": self.events[after:],
                "nextCursor": len(self.events)}
        if self.result is not None:
            data["result"] = dump(self.result)
        return data


class JobManager:
    def __init__(self, settings, gateway=None):
        self.settings = settings
        self.gateway = gateway
        self.jobs: dict[str, Job] = {}
        self.requests = {}
        self.semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._pending_releases: set[str] = set()
        self._release_tasks: dict[str, asyncio.Task] = {}
        self._closed = False

    async def _release_counter(self, job_id):
        try:
            await self.gateway.release_job(job_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Keep pending for the next prune; never expose provider internals.
            logger.warning(json.dumps({"event": "model_counter_cleanup_failed"}))
        else:
            self._pending_releases.discard(job_id)

    def _schedule_releases(self):
        if not callable(getattr(self.gateway, "release_job", None)):
            self._pending_releases.clear()
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Synchronous maintenance can prune; close/next async prune drains.
            return
        for job_id in self._pending_releases - self._release_tasks.keys():
            task = loop.create_task(self._release_counter(job_id))
            self._release_tasks[job_id] = task
            task.add_done_callback(lambda completed, key=job_id: self._release_tasks.pop(key, None))

    def prune(self):
        now = time.monotonic()
        expired = {k for k, v in self.jobs.items() if v.finished is not None
                   and now - v.finished >= self.settings.job_ttl_seconds
                   and (v.task is None or v.task.done())}
        for key in expired:
            del self.jobs[key]
        self._pending_releases.update(expired)
        self._schedule_releases()
        self.requests = {k: v for k, v in self.requests.items() if v[1] in self.jobs}

    def submit(self, path, request_id, trace_id, body, operation):
        if self._closed:
            raise AppError("API_UNAVAILABLE", "服务正在关闭，请稍后重试。", 503, True)
        self.prune()
        key, body_hash = (path, request_id), digest(body)
        if key in self.requests:
            previous_hash, job_id = self.requests[key]
            if previous_hash != body_hash:
                raise AppError("REQUEST_ID_CONFLICT", "同一请求 ID 对应不同请求内容。", 409)
            return self.jobs[job_id]
        if len(self.jobs) >= self.settings.max_jobs:
            raise AppError("RATE_LIMITED", "任务暂存容量已满，请稍后重试。", 429, True)
        payload = dump(body)
        context = {k: payload[k] for k in ("tripId", "baseRevision", "executionMode", "demoRunId") if k in payload}
        job = Job(uuid.uuid4().hex, request_id, trace_id, context)
        self.jobs[job.job_id] = job
        self.requests[key] = (body_hash, job.job_id)
        job.task = asyncio.create_task(self._run(job, operation))
        return job

    async def _run(self, job, operation):
        try:
            async with asyncio.timeout(self.settings.max_job_seconds):
                async with self.semaphore:
                    if job.status == "CANCELLED":
                        return
                    job.status = "RUNNING"
                    result, partial = await operation(job)
                    if job.status != "CANCELLED":
                        job.result = dump(result)
                        job.status = "PARTIAL" if partial else "SUCCEEDED"
        except asyncio.CancelledError:
            job.status = "CANCELLED"
        except TimeoutError:
            job.status = "FAILED"
            job.errors = [AppError("JOB_TIMEOUT", "任务超过执行时限。", 504, True).public()]
        except Exception as exc:
            job.status = "FAILED"
            job.errors = [public_error(exc)]
            logger.warning(json.dumps({"event": "job_failed", "trace_id": job.trace_id,
                                       "code": job.errors[0]["code"], "exception_type": type(exc).__name__}))
        finally:
            job.finished = time.monotonic()

    def get(self, job_id):
        self.prune()
        if job_id not in self.jobs:
            raise AppError("JOB_NOT_FOUND", "任务不存在、已过期或实例已重启，请重新发起。", 404)
        return self.jobs[job_id]

    def cancel(self, job_id):
        job = self.get(job_id)
        if job.status not in TERMINAL:
            job.status = "CANCELLED"
            job.finished = time.monotonic()
            job.task.cancel()
        return job

    async def close(self):
        self._closed = True
        tasks = []
        for job in self.jobs.values():
            if job.task and not job.task.done():
                job.status = "CANCELLED"
                job.finished = time.monotonic()
                job.task.cancel()
                tasks.append(job.task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        # Closing the manager invalidates its lifetime. Release only after all
        # computations stop, including cancellation handlers with late cleanup.
        self._pending_releases.update(self.jobs)
        self._schedule_releases()
        if self._release_tasks:
            await asyncio.gather(*list(self._release_tasks.values()), return_exceptions=True)
