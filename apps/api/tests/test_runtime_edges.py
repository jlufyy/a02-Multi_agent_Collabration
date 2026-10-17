"""Regression gates from integration review. All provider inputs are synthetic."""
import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest

from app.config import Settings
from app.errors import AppError
from app.gateway import ModelGateway
from app.jobs import Job, JobManager
from app.main import create_app
from app.middleware import RequestGuard
from app.planning import build_plan, build_proposal
from app.providers import ProviderError
from app.schemas import TripRequirements
from app.workflows import Workflows


def run(coro):
    return asyncio.run(coro)


def test_server_uses_configured_model_timeout(monkeypatch):
    monkeypatch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: None)
    monkeypatch.setenv("TRIPFLOW_MODEL_TIMEOUT_SECONDS", "75")
    settings = Settings.from_env()
    app = create_app(settings)
    assert app.state.workflows.gateway.timeout == 75
    run(app.state.workflows.gateway.aclose())
    run(app.state.workflows.maps.aclose())
    with pytest.raises(ValueError):
        Settings(model_timeout_seconds=0)


def test_expired_jobs_release_model_call_counter_capacity():
    """Once result TTL expires, new model jobs must regain counter capacity."""
    async def check():
        def handler(request):
            return httpx.Response(200, json={"model": "synthetic-model", "choices": [{"finish_reason": "stop", "message": {"content": "synthetic"}}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": {"kind": "openai-compatible", "base_url": "https://test.invalid/v1", "api_key": "synthetic", "model": "synthetic"}},
                                   {"A7": "p"}, client=client, max_job_counters=1)
            app = create_app(Settings(job_ttl_seconds=1), maps=SimpleNamespace(configured=False), gateway=gateway)
            jobs = app.state.jobs
            async def operation(job):
                await gateway.generate_text("A7", {}, job.job_id)
                return {}, False
            job = jobs.submit("/test", "one", "trace", {"tripId": "synthetic"}, operation)
            await job.task
            job.finished = time.monotonic()-2
            jobs.prune()
            await asyncio.sleep(0)
            assert job.job_id not in jobs.jobs
            assert job.job_id not in gateway._calls, "Expired job leaks model counter, eventually blocking all new jobs"
            second = jobs.submit("/test", "two", "trace", {"tripId": "synthetic"}, operation)
            await second.task
            assert second.status == "SUCCEEDED"
            await jobs.close()
    run(check())


def test_final_validation_cannot_trust_client_supplied_verified_poi_facts():
    """A one-stop fake plan must not bypass A2 just because no route is needed."""
    async def check():
        claims = {"provider": "amap", "externalId": "nonexistent-test-id", "status": "VERIFIED", "fetchedAt": "2026-10-16T00:00:00Z"}
        req = TripRequirements.model_validate({"requirementsId": "test", "version": 1, "confirmed": True,
            "destinationCity": "合成测试城市", "startDate": "2026-10-20", "endDate": "2026-10-20", "timezone": "Asia/Shanghai",
            "travelerCount": 1, "budgetIsHardLimit": True, "transportModes": ["WALK"], "mustVisit": [], "avoidPlaces": [],
            "preferences": [], "companions": [], "specialNeeds": [], "fixedConstraints": [], "intents": []})
        fake = {"poiId": "nonexistent-test-id", "name": "客户端伪造地点", "location": {"lat": 39.9, "lng": 116.4, "coordinateSystem": "GCJ02"},
                "evidence": [claims], "openingHours": {"value": "24h", "evidence": claims}, "ticketPriceCny": {"value": 0, "evidence": claims}}
        plan = build_plan("test-trip", req, [fake])
        proposal = build_proposal(plan, plan, [])
        calls = []
        class MissingMaps:
            async def poi_detail(self, poi_id):
                calls.append(poi_id)
                raise ProviderError("PLACE_UNVERIFIED", "synthetic missing POI", http_status=422)
        workflows = Workflows(MissingMaps(), None)
        request = SimpleNamespace(tripState=plan, proposal=proposal, baseRevision=plan.revision)
        try:
            result, partial = await workflows.validate(request, Job("test-job", "request", "trace", {}))
        except ProviderError:
            assert calls
        else:
            assert calls, "I06 never rechecks client POI identity/facts with A2"
            assert not result.validation.committable
    run(check())


def test_request_timeout_also_bounds_slow_body_receive():
    async def check():
        reached_app = False
        async def app(scope, receive, send):
            nonlocal reached_app
            reached_app = True
        guard = RequestGuard(app, Settings(request_timeout_seconds=.01))
        messages = []
        async def receive():
            await asyncio.sleep(1)
            return {"type": "http.request", "body": b"{}", "more_body": False}
        async def send(message):
            messages.append(message)
        scope = {"type": "http", "method": "POST", "path": "/api/v1/places/search", "client": ("test", 1),
                 "headers": [(b"x-request-id", b"slow-body-test")]}
        try:
            await asyncio.wait_for(guard(scope, receive, send), timeout=.15)
        except TimeoutError:
            assert False, "Body receive runs outside configured request timeout"
        assert not reached_app
        assert messages[0]["status"] == 504
        assert json.loads(messages[1]["body"])["errors"][0]["code"] == "REQUEST_TIMEOUT"
    run(check())


def test_unique_but_different_poi_does_not_silently_bind_ambiguous_intent():
    async def check():
        class Maps:
            async def search_pois(self, query, city=None):
                return [{"poiId": "synthetic-shop", "name": "天安门附近合成奶茶店"}]
        class Context:
            async def tool(self, name, function, *args, **kwargs):
                return await function(*args, **kwargs)
        try:
            await Workflows(Maps(), None).resolve_reference(Context(), {"query": "天安门"}, "北京")
        except AppError as error:
            assert error.code in {"PLACE_AMBIGUOUS", "PLACE_UNVERIFIED"}
        else:
            assert False, "One fuzzy upstream result must still require explicit POI selection"
    run(check())


def test_cancel_keeps_call_budget_until_computation_stopped_and_ttl_expired():
    async def check():
        class Gateway:
            def __init__(self):
                self.calls = {}
            async def release_job(self, job_id):
                self.calls.pop(job_id, None)
        gateway = Gateway()
        jobs = JobManager(Settings(job_ttl_seconds=1), gateway)
        started, cleanup = asyncio.Event(), asyncio.Event()
        async def operation(job):
            gateway.calls[job.job_id] = 1
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await cleanup.wait()
                raise
        job = jobs.submit("/test", "cancel", "trace", {}, operation)
        await started.wait()
        jobs.cancel(job.job_id)
        await asyncio.sleep(0)
        job.finished = time.monotonic()-2
        jobs.prune()
        assert job.job_id in jobs.jobs and job.job_id in gateway.calls
        cleanup.set()
        await job.task
        assert job.status == "CANCELLED"
        jobs.prune()
        assert job.job_id in gateway.calls  # terminal result's TTL remains
        job.finished = time.monotonic()-2
        jobs.prune()
        await asyncio.sleep(0)
        assert job.job_id not in gateway.calls
        await jobs.close()
    run(check())


def test_close_awaits_running_jobs_and_counter_cleanup_then_rejects_submit():
    async def check():
        class Gateway:
            def __init__(self):
                self.calls = set()
            async def release_job(self, job_id):
                await asyncio.sleep(0)
                self.calls.discard(job_id)
        gateway = Gateway()
        jobs = JobManager(Settings(), gateway)
        started = asyncio.Event()
        async def operation(job):
            gateway.calls.add(job.job_id)
            started.set()
            await asyncio.Event().wait()
        job = jobs.submit("/test", "close", "trace", {}, operation)
        await started.wait()
        await jobs.close()
        assert job.status == "CANCELLED" and job.task.done()
        assert not gateway.calls and not jobs._release_tasks and not jobs._pending_releases
        with pytest.raises(AppError) as error:
            jobs.submit("/test", "after-close", "trace", {}, operation)
        assert error.value.http_status == 503
    run(check())


async def guarded_request(headers=(), chunks=None, *, maximum=32, guard=None):
    calls, output, received = [], [], []
    async def app(scope, receive, send):
        calls.append(await receive())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"ok":true}'})
    guard = guard or RequestGuard(app, Settings(max_body_bytes=maximum))
    remaining = list(chunks or [{"type": "http.request", "body": b"{}", "more_body": False}])
    async def receive():
        received.append(True)
        return remaining.pop(0) if remaining else {"type": "http.disconnect"}
    async def send(message):
        output.append(message)
    await guard({"type": "http", "method": "POST", "path": "/test", "client": ("test", 1),
                 "headers": [(b"x-request-id", b"bounded-body"), *headers]}, receive, send)
    return output, calls, received


@pytest.mark.parametrize("value", [b"-1", b"a", b"1,1", b" 2", b"", b"9"*100])
def test_invalid_content_length_rejected_before_reading_body(value):
    async def check():
        output, calls, received = await guarded_request([(b"content-length", value)])
        assert output[0]["status"] == 422
        assert not calls and not received
    run(check())


@pytest.mark.parametrize("headers", [
    [(b"content-length", b"2"), (b"content-length", b"2")],
    [(b"content-length", b"2"), (b"transfer-encoding", b"chunked")],
    [(b"transfer-encoding", b"gzip")],
])
def test_conflicting_body_framing_rejected(headers):
    async def check():
        output, calls, received = await guarded_request(headers)
        assert output[0]["status"] == 422
        assert not calls and not received
    run(check())


def test_declared_oversized_body_rejected_before_read_and_chunked_bytes_bounded():
    async def check():
        output, calls, received = await guarded_request([(b"content-length", b"33")])
        assert output[0]["status"] == 413 and not calls and not received
        output, calls, received = await guarded_request(chunks=[
            {"type": "http.request", "body": b"a"*20, "more_body": True},
            {"type": "http.request", "body": b"b"*20, "more_body": True}])
        assert output[0]["status"] == 413 and not calls and len(received) == 2
    run(check())


@pytest.mark.parametrize("declared", [b"1", b"3"])
def test_actual_content_length_must_match(declared):
    async def check():
        output, calls, _ = await guarded_request([(b"content-length", declared)])
        assert output[0]["status"] == 422 and not calls
    run(check())


def test_chunked_body_without_content_length_is_supported_and_chunk_count_bounded():
    async def check():
        output, calls, _ = await guarded_request([(b"transfer-encoding", b"chunked")], [
            {"type": "http.request", "body": b"{", "more_body": True},
            {"type": "http.request", "body": b"}", "more_body": False}])
        assert output[0]["status"] == 200 and calls[0]["body"] == b"{}"
        output, calls, received = await guarded_request(chunks=[
            {"type": "http.request", "body": b"", "more_body": True} for _ in range(8193)])
        assert output[0]["status"] == 413 and not calls and len(received) == 8193
    run(check())


def test_middleware_idempotency_replay_and_conflict_still_work():
    async def check():
        calls = []
        async def app(scope, receive, send):
            calls.append(await receive())
            await send({"type": "http.response.start", "status": 202, "headers": []})
            await send({"type": "http.response.body", "body": b'{"jobId":"synthetic"}'})
        guard = RequestGuard(app, Settings())
        first, _, _ = await guarded_request(guard=guard)
        repeat, _, _ = await guarded_request(guard=guard)
        assert first == repeat and len(calls) == 1
        changed, _, _ = await guarded_request(chunks=[{"type": "http.request", "body": b'{"changed":true}', "more_body": False}], guard=guard)
        assert changed[0]["status"] == 409 and len(calls) == 1
    run(check())
