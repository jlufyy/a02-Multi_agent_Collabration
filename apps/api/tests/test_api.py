"""HTTP/workflow integration with explicitly synthetic providers; no live API claims."""
import asyncio
import copy
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.config import Settings
from app.jobs import dump
from app.providers import ProviderError
from app import schemas as s
from test_planning import requirements, poi


class SyntheticMaps:
    configured = True

    def __init__(self):
        self.places = [poi(f"p{i}", f"合成景点{i}") for i in range(6)]
        for i, place in enumerate(self.places):
            place["location"]["lat"] += i * .001
        self.calls = []
        self.route_failure = False
        self.minutes = 10

    async def aclose(self):
        pass

    async def search_pois(self, query, **kwargs):
        self.calls.append(("search", query))
        exact = [p for p in self.places if p["name"] == query]
        return copy.deepcopy(exact or self.places)

    async def poi_detail(self, poi_id):
        self.calls.append(("detail", poi_id))
        return copy.deepcopy(next(p for p in self.places if p["poiId"] == poi_id))

    async def routes(self, origin, destination, mode, **kwargs):
        self.calls.append(("route", mode))
        if self.route_failure:
            raise ProviderError("API_UNAVAILABLE", "Synthetic route failure")
        return {"mode": mode, "durationMin": self.minutes, "distanceMeters": 100,
                "routeGeometry": [origin, destination], "evidence": copy.deepcopy(self.places[0]["evidence"][0])}

    async def nearby_pois(self, *args, **kwargs):
        return copy.deepcopy(self.places)


class SyntheticGateway:
    configured = True

    def __init__(self):
        self.delay = 0
        self.reply = None

    async def aclose(self):
        pass

    async def generate_structured(self, role, schema, payload, **kwargs):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.reply:
            data = self.reply
        elif schema.__name__ == "ExtractionDraft":
            req = dump(requirements())
            req["confirmed"] = False
            data = {"requirements": req, "missingFields": [], "uncertainFields": []}
        elif schema.__name__ == "ContentDraft":
            data = {"title": "合成测试文案", "body": "仅用于离线验证的创作辅助内容。", "usedEvidenceIndices": [0]}
        else:
            data = {"kind": "CONTENT", "operations": [], "questions": []}
        return SimpleNamespace(data=data, usage={"provider": "SYNTHETIC_TEST", "model": "no-real-model", "latencyMs": 0})


@pytest.fixture
def env():
    maps, gateway = SyntheticMaps(), SyntheticGateway()
    app = create_app(Settings(rate_limit_per_minute=10000), maps, gateway)
    with TestClient(app) as client:
        yield client, maps, gateway, app


def post(client, path, body, request_id=None):
    return client.post("/api/v1" + path, json=body, headers={"X-Request-Id": request_id or uuid4().hex})


def wait(client, response):
    assert response.status_code == 202, response.text
    job_id = response.json()["data"]["jobId"]
    for _ in range(200):
        result = client.get("/api/v1/jobs/" + job_id)
        assert result.status_code == 200, result.text
        if result.json()["status"] in ("PARTIAL", "SUCCEEDED", "FAILED", "CANCELLED"):
            return result.json()
        time.sleep(.005)
    pytest.fail("synthetic job did not terminate")


def context(plan=None, **kwargs):
    return {"tripId": plan["tripId"] if plan else "synthetic-trip", "baseRevision": plan["revision"] if plan else 0,
            "executionMode": "REAL", **({"tripState": plan} if plan else {}), **kwargs}


def generate(client, days=1, intents=False):
    raw = dump(requirements(days))
    if intents:
        raw["intents"] = [{"id": "intent-video", "placeQuery": "合成景点0", "type": "VIDEO_SHOOT",
                           "userRequest": "在此拍摄旅行演讲", "desiredOutputs": ["讲稿", "清单"], "confirmed": True,
                           "status": "PENDING", "preparedContentIds": [], "locked": False}]
    result = wait(client, post(client, "/plans/generate", context(requirements=raw, mode="PLANNING")))
    assert result["status"] in ("SUCCEEDED", "PARTIAL"), result
    return result


def test_health_contract_and_missing_keys_fail_honestly():
    with TestClient(create_app(Settings())) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = s.ApiResponse[s.HealthResult].model_validate(response.json()).data
        assert data.serviceStatus == "DEGRADED" and not data.capabilities.poiSearch
        search = post(client, "/places/search", {"executionMode": "REAL", "city": "北京", "keyword": "天坛"})
        assert search.status_code == 503 and search.json()["errors"][0]["code"] == "API_UNAVAILABLE"
        result = wait(client, post(client, "/requirements/parse", context(text="北京两日游")))
        assert result["status"] == "FAILED" and result["errors"][0]["code"] == "API_UNAVAILABLE"


@pytest.mark.parametrize("days", [1, 2, 3])
def test_full_generation_real_events_and_repeatable_result(env, days):
    client, _, _, _ = env
    result = generate(client, days, intents=True)
    plan_result = s.PlanResult.model_validate(result["data"]["result"])
    assert plan_result.validation.committable
    assert {a.dayIndex for a in plan_result.plan.activities} == set(range(days))
    assert plan_result.preparedContents and plan_result.plan.intents[0].status == "READY"
    events = result["data"]["progressEvents"]
    assert {e["agentId"] for e in events} >= {"A2", "A3", "A4", "A5", "A7"}
    assert [e["sequence"] for e in events] == list(range(1, len(events)+1))
    assert any(e["type"] == "tool_call_finished" for e in events)
    url = "/api/v1/jobs/" + result["data"]["jobId"]
    repeated = client.get(url + "?afterSequence=" + str(len(events))).json()
    assert not repeated["data"]["progressEvents"]
    assert repeated["data"]["result"] == result["data"]["result"]
    assert client.get(url + "?afterSequence=9999").status_code == 422


def test_atomic_revision_validate_and_preserve_original(env):
    client, maps, _, _ = env
    plan = generate(client)["data"]["result"]["plan"]
    original = copy.deepcopy(plan)
    ids = [a["id"] for a in plan["activities"]]
    result = wait(client, post(client, "/revisions/propose", context(plan, operations=[
        {"type": "MOVE", "activityId": ids[0], "dayIndex": 0, "orderIndex": len(ids)-1},
        {"type": "UPDATE_DURATION", "activityId": ids[1], "durationMin": 40}])))
    assert result["status"] in ("PARTIAL", "SUCCEEDED"), result
    proposal = result["data"]["result"]["proposal"]
    assert proposal["candidate"]["revision"] == plan["revision"]
    assert plan == original and proposal["diff"]["moved"]
    validated = wait(client, post(client, "/revisions/validate", context(plan, proposal=proposal)))
    assert validated["data"]["result"]["validation"]["committable"], validated
    maps.minutes = 90
    changed = wait(client, post(client, "/revisions/validate", context(plan, proposal=proposal)))
    assert not changed["data"]["result"]["validation"]["committable"]
    assert any("REPROPOSE_REQUIRED" in u for u in changed["data"]["result"]["validation"]["unknownChecks"])


def test_parse_context_chat_and_refine(env):
    client, _, _, _ = env
    parsed = wait(client, post(client, "/requirements/parse", context(text="合成城市两人旅游")))
    assert parsed["status"] == "SUCCEEDED"
    assert parsed["data"]["result"]["requirements"]["confirmed"] is False
    plan = generate(client)["data"]["result"]["plan"]
    selected = {"tripId": plan["tripId"], "planRevision": plan["revision"], "mode": plan["mode"],
                "activeDay": 0, "selectedActivityId": plan["activities"][0]["id"]}
    result = wait(client, post(client, "/revisions/propose", context(plan, userRequest="讲解这里", selectedContext=selected)))
    assert result["data"]["result"]["kind"] == "CONTENT", result
    prepared = result["data"]["result"]["content"]
    refined = wait(client, post(client, "/content/refine", context(plan, userRequest="简短一点", context=selected, preparedContent=prepared)))
    assert refined["data"]["result"]["content"]["version"] == 2, refined
    ambiguous = wait(client, post(client, "/revisions/propose", context(plan, userRequest="讲解这里")))
    assert ambiguous["data"]["result"]["kind"] == "CLARIFICATION"


def test_proactive_intent_dedup_pause_and_demo_isolation(env):
    client, _, _, _ = env
    plan = generate(client, intents=True)["data"]["result"]["plan"]
    plan.update(mode="TRAVELING", lifecycle="TRAVELING")
    activity = next(a for a in plan["activities"] if a["id"] == plan["intents"][0]["activityId"])
    activity["progress"] = "ARRIVED"
    event = {"eventId": "synthetic-event", "tripId": plan["tripId"], "revision": plan["revision"], "source": "REAL", "type": "ARRIVE",
             "activityId": activity["id"], "arrivalId": "synthetic-arrival", "location": activity["place"]["location"],
             "accuracyMeters": 10, "occurredAt": activity["startAt"]}
    body = context(plan, currentEvent=event, recentNotifications=[], uiBusy=False)
    result = wait(client, post(client, "/proactive/evaluate", body))
    assert result["status"] == "SUCCEEDED", result
    decision = result["data"]["result"]["decision"]
    assert decision["shouldNotify"] and decision["card"]["level"] == "L2"
    assert "shownAt" not in str(result["data"]["result"])
    body["recentNotifications"] = [{"notificationId": "n", "eventId": event["eventId"], "tripRevision": plan["revision"],
                                   "source": "REAL", "arrivalId": event["arrivalId"], "activityId": activity["id"], "intentId": "intent-video",
                                   "level": "L2", "decision": "SHOWN", "shownAt": event["occurredAt"]}]
    suppressed = wait(client, post(client, "/proactive/evaluate", body))
    assert not suppressed["data"]["result"]["decision"]["shouldNotify"]
    body["currentEvent"].update(source="SIMULATED", demoRunId="run")
    assert post(client, "/proactive/evaluate", body).status_code == 422


def test_sync_routes_failure_and_nearby(env):
    client, maps, _, _ = env
    plan = generate(client)["data"]["result"]["plan"]
    maps.route_failure = True
    body = context(requirements=plan["requirements"], activities=plan["activities"], mode="WALK")
    result = post(client, "/routes/segments", body)
    assert result.json()["status"] == "PARTIAL", result.text
    assert all("durationMin" not in seg and seg["evidence"]["status"] == "FAILED" for seg in result.json()["data"]["segments"])
    nearby = wait(client, post(client, "/nearby/search", context(plan, location=plan["activities"][0]["place"]["location"], category="FOOD", preferences=[])))
    assert nearby["data"]["result"]["candidates"]
    assert all(c["distanceEvidence"]["status"] == "ESTIMATED" for c in nearby["data"]["result"]["candidates"])


def test_idempotency_missing_header_stale_and_cancel(env):
    client, _, gateway, _ = env
    body = context(text="中文旅行需求")
    assert client.post("/api/v1/requirements/parse", json=body).status_code == 422
    request_id = uuid4().hex
    first = post(client, "/requirements/parse", body, request_id)
    again = post(client, "/requirements/parse", body, request_id)
    assert first.json() == again.json()
    assert post(client, "/requirements/parse", {**body, "text": "不同"}, request_id).status_code == 409
    gateway.delay = 1
    slow = post(client, "/requirements/parse", body)
    url = "/api/v1/jobs/" + slow.json()["data"]["jobId"]
    assert client.delete(url).json()["data"]["status"] == "CANCELLED"
    assert client.delete(url).json()["data"]["status"] == "CANCELLED"
    assert client.get(url).json()["status"] == "CANCELLED"
    assert client.get("/api/v1/jobs/missing").status_code == 404
    gateway.delay = 0
    plan = generate(client)["data"]["result"]["plan"]
    stale = context(plan, baseRevision=999, userRequest="帮我调整")
    assert post(client, "/revisions/propose", stale).status_code == 409


def test_size_limit_cors_errors_and_openapi():
    with TestClient(create_app(Settings(max_body_bytes=50, rate_limit_per_minute=2))) as client:
        response = client.post("/api/v1/requirements/parse", content="x"*100,
                               headers={"X-Request-Id": "x", "Origin": "http://localhost:5173"})
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert response.json()["errors"][0]["code"] == "REQUEST_TOO_LARGE"
        assert client.get("/api/v1/capabilities").status_code == 200
        assert client.get("/api/v1/capabilities").status_code == 429
        assert client.get("/api/v1/health").status_code == 200
    app = create_app(Settings())
    spec = app.openapi()
    assert sum(len([m for m in p if m in ("get", "post", "delete")]) for p in spec["paths"].values()) == 16


def test_prepare_knowledge_and_credible_risk_rules(env):
    client, _, _, _ = env
    plan = generate(client, intents=True)["data"]["result"]["plan"]
    prepared = wait(client, post(client, "/content/prepare", context(plan, intents=plan["intents"])))
    assert prepared["data"]["result"]["contents"]
    plan.update(mode="TRAVELING", lifecycle="TRAVELING")
    activity = next(a for a in plan["activities"] if a["id"] == plan["intents"][0]["activityId"])
    activity["progress"] = "ARRIVED"
    plan["intents"][0]["type"] = "KNOWLEDGE"
    plan["requirements"]["intents"][0]["type"] = "KNOWLEDGE"
    event = {"eventId": "k", "tripId": plan["tripId"], "revision": plan["revision"], "source": "REAL", "type": "ARRIVE",
             "activityId": activity["id"], "arrivalId": "a", "location": activity["place"]["location"], "accuracyMeters": 10, "occurredAt": activity["startAt"]}
    body = context(plan, currentEvent=event, recentNotifications=[], uiBusy=False)
    knowledge = wait(client, post(client, "/proactive/evaluate", body))
    assert knowledge["data"]["result"]["decision"]["card"]["level"] == "L1"
    plan["notificationPolicy"]["paused"] = True
    event.update(type="RISK", source="SIMULATED", demoRunId="demo", risk={"code": "SIMULATED_TIME_CONFLICT",
                 "message": "显式模拟风险", "activityIds": [activity["id"]], "evidence": activity["place"]["evidence"]})
    risk = wait(client, post(client, "/proactive/evaluate", context(plan, executionMode="DEMO", demoRunId="demo", currentEvent=event, recentNotifications=[], uiBusy=True)))
    assert risk["data"]["result"]["decision"]["card"]["level"] == "L3"
    assert risk["data"]["result"]["contents"] == []
    event["source"] = "REAL"
    event.pop("demoRunId")
    unproven = wait(client, post(client, "/proactive/evaluate", context(plan, currentEvent=event, recentNotifications=[], uiBusy=False)))
    assert unproven["data"]["result"]["decision"]["reasonCode"] == "RISK_NOT_REPRODUCIBLE"
