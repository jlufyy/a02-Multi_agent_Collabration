"""Opt-in HTTP integration audit. Real providers; synthetic travel request, no GPS.

Usage: .venv/Scripts/python apps/api/scripts/integration_verify.py --url http://127.0.0.1:8010
Writes NEW evidence files; does not overwrite the previous backend acceptance.
"""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import time
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8010")
    parser.add_argument("--fallback-plan-job", help="Continue remaining checks from an already successful real plan/proposal job")
    parser.add_argument("--reuse-parse-job", help="Reuse a completed real parse job from this running instance")
    parser.add_argument("--output", type=Path, default=ROOT / "output/integration", help="Evidence directory; choose a new directory to preserve earlier runs")
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    cases, samples = [], []
    report = {"timestamp": datetime.now(timezone(timedelta(hours=8))).isoformat(),
              "baseUrl": args.url, "evidenceType": "LIVE_HTTP_SYNTHETIC_TRAVEL_INPUT", "cases": cases}

    def save():
        (output / "live-http.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (output / "contract-samples.json").write_text(json.dumps(samples, ensure_ascii=False), encoding="utf-8")

    def record(name, passed, **details):
        item = {"case": name, "status": "PASS" if passed else "FAIL", **details}
        cases.append(item)
        save()
        print(json.dumps(item, ensure_ascii=False), flush=True)

    with httpx.Client(base_url=args.url, timeout=50, trust_env=False) as client:
        def request(path, body=None, request_id=None):
            if body is None:
                return client.get(path)
            return client.post(path, json=body, headers={"X-Request-Id": request_id or uuid4().hex})

        def job(name, path, body, schema):
            start = time.monotonic()
            accepted = request(path, body)
            if accepted.status_code != 202:
                record(name, False, http=accepted.status_code, errors=accepted.json().get("errors", []))
                return None
            samples.append({"case": name + "-accepted", "schema": "JobAccepted", "response": accepted.json()})
            cursor, sequences = 0, []
            while time.monotonic() - start < 195:
                time.sleep(2)
                snap = client.get(f"/api/v1/jobs/{accepted.json()['data']['jobId']}", params={"afterSequence": cursor})
                payload = snap.json()
                if snap.status_code != 200:
                    record(name, False, http=snap.status_code, errors=payload.get("errors", []))
                    return None
                data = payload["data"]
                sequences.extend(e["sequence"] for e in data["progressEvents"])
                cursor = data["nextCursor"]
                if data["status"] in ("SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"):
                    samples.append({"case": name, "schema": schema, "job": True, "response": payload})
                    record(name, data["status"] in ("SUCCEEDED", "PARTIAL"), jobStatus=data["status"],
                           seconds=round(time.monotonic()-start, 2), traceId=payload["trace_id"],
                           progressSequenceMonotonic=sequences == sorted(set(sequences)),
                           errors=payload["errors"])
                    return data.get("result")
            record(name, False, reason="audit timeout")
            return None

        for name, path, schema in (("health", "/api/v1/health", "HealthData"), ("capabilities", "/api/v1/capabilities", "CapabilitySet")):
            response = request(path)
            record(name, response.status_code == 200, http=response.status_code)
            samples.append({"case": name, "schema": schema, "response": response.json()})
            if name == "capabilities":
                report["modelRoutes"] = response.json()["data"]["modelRoutes"]
        for path in ("/", "/favicon.svg", "/docs", "/openapi.json"):
            response = request(path)
            record("serve-" + path, response.status_code == 200, http=response.status_code)
        for path in ("/.env", "/apps/api/app/config.py", "/api/v1/missing", "/assets/missing.js"):
            response = request(path)
            record("reject-" + path, response.status_code == 404 and "application/json" in response.headers.get("content-type", ""), http=response.status_code)
        places = request("/api/v1/places/search", {"executionMode": "REAL", "city": "北京", "keyword": "天坛公园"})
        record("live-poi-search", places.status_code == 200 and bool(places.json().get("data", {}).get("places")))
        samples.append({"case": "places", "schema": "PlacesResult", "response": places.json()})
        ctx = {"executionMode": "REAL", "tripId": "integration-" + uuid4().hex[:8], "baseRevision": 0}
        if args.reuse_parse_job:
            response = request('/api/v1/jobs/' + args.reuse_parse_job).json()
            parsed = response['data'].get('result')
            samples.append({'case': 'deepseek-parse-reused-live-job', 'schema': 'ParseResult', 'job': True, 'response': response})
            record('deepseek-parse-reused-live-job', bool(parsed), traceId=response['trace_id'])
        else:
            parsed = job("deepseek-parse", "/api/v1/requirements/parse", {**ctx, "text":
                "2026年10月20日一个人去北京一日游，9点到18点，步行，喜欢历史文化，不指定必去景点，没有地点任务。预算人均300元但不是硬上限，不含住宿和城际交通。"}, "ParseResult")
        if not parsed:
            return
        req = copy.deepcopy(parsed["requirements"])
        record("parse-factual-fields", req.get("destinationCity") == "北京" and req.get("travelerCount") == 1
               and req.get("startDate") == "2026-10-20" and req.get("confirmed") is False)
        req.update(confirmed=True, startDate="2026-10-20", endDate="2026-10-20", travelerCount=1,
                   dailyStartTime="09:00", dailyEndTime="18:00", transportModes=["WALK"], mustVisit=[], intents=[])
        result = job("live-plan", "/api/v1/plans/generate", {**ctx, "requirements": req, "mode": "PLANNING"}, "PlanResult")
        using_fallback = False
        if not result or not result.get("plan"):
            if not args.fallback_plan_job:
                return
            fallback = request('/api/v1/jobs/' + args.fallback_plan_job).json()['data']['result']
            plan = copy.deepcopy(fallback.get('plan') or fallback['proposal']['candidate'])
            # Test inputs can explicitly choose verified places; never alter the browser's saved plan.
            by_name = {a['place']['name']: a['place'] for a in plan['activities']}
            for ref in plan['requirements']['mustVisit']:
                if not ref.get('place') and ref['query'] in by_name:
                    ref['place'] = by_name[ref['query']]
            ctx['tripId'] = plan['tripId']
            result = {'plan': plan, 'validation': fallback.get('validation') or fallback['proposal']['validation']}
            using_fallback = True
            record('remaining-checks-use-existing-plan', True, evidenceNote='Fallback test request with explicit verified POI binding; failed generation and browser defect remain unfixed.')
        plan = result["plan"]
        if using_fallback:
            record("fallback-source-validation", True, status="OBSERVATION", activities=len(plan["activities"]),
                   validation=result["validation"]["status"], committable=result["validation"]["committable"],
                   unknownChecks=result["validation"]["unknownChecks"],
                   note="Original source proposal was blocked. Remaining requests explicitly bind the known POI; application and browser state remain unchanged.")
        else:
            record("plan-input-validation", result["validation"]["committable"], activities=len(plan["activities"]),
                   validation=result["validation"]["status"], unknownChecks=result["validation"]["unknownChecks"])
        plan["revision"] = 1
        ctx["baseRevision"] = 1
        selected = {"tripId": ctx["tripId"], "planRevision": 1, "mode": "PLANNING", "activeDay": 0,
                    "selectedActivityId": plan["activities"][0]["id"], "selectedPoiId": plan["activities"][0]["place"]["poiId"]}
        routes = request("/api/v1/routes/segments", {**ctx, "requirements": plan["requirements"], "activities": plan["activities"], "mode": "WALK"})
        record("live-route-segments", routes.status_code == 200, http=routes.status_code)
        samples.append({"case": "routes", "schema": "RoutesResult", "response": routes.json()})
        proposal = job("live-propose", "/api/v1/revisions/propose", {**ctx, "tripState": plan,
            "operations": [{"type": "UPDATE_DURATION", "activityId": plan["activities"][0]["id"], "durationMin": 100}]}, "RevisionResult")
        if proposal and proposal.get("kind") == "REVISION":
            final = job("live-final-validate", "/api/v1/revisions/validate", {**ctx, "tripState": plan, "proposal": proposal["proposal"]}, "ValidateResult")
            record("final-validation-committable", bool(final and final["validation"]["committable"]))
        job("live-nearby", "/api/v1/nearby/search", {**ctx, "tripState": plan,
            "location": plan["activities"][0]["place"]["location"], "category": "FOOD", "preferences": [], "selectedContext": selected}, "NearbyResult")
        content = job("configured-a7-content", "/api/v1/content/refine", {**ctx, "tripState": plan, "context": selected,
            "userRequest": "用中文写80字的游览提示，仅依据已有地点信息，不编造历史或营业政策。"}, "ContentResult")
        job("empty-content-prepare", "/api/v1/content/prepare", {**ctx, "tripState": plan, "intents": []}, "ContentsResult")
        # DEMO input is explicitly simulated; it is never evidence of actual arrival.
        demo_ctx = {**ctx, "executionMode": "DEMO", "demoRunId": "integration-demo"}
        demo_plan = copy.deepcopy(plan)
        demo_plan.update(mode="TRAVELING", lifecycle="TRAVELING")
        demo_plan["activities"][0]["progress"] = "ARRIVED"
        event = {"eventId": uuid4().hex, "tripId": ctx["tripId"], "revision": 1, "source": "SIMULATED",
            "demoRunId": "integration-demo", "type": "ARRIVE", "activityId": demo_plan["activities"][0]["id"],
            "arrivalId": "integration-arrival", "occurredAt": datetime.now(timezone.utc).isoformat()}
        job("demo-proactive-not-real-gps", "/api/v1/proactive/evaluate", {**demo_ctx, "tripState": demo_plan,
            "currentEvent": event, "recentNotifications": [], "uiBusy": False}, "EvaluateResult")
        bad = request("/api/v1/revisions/propose", {**ctx, "baseRevision": 99, "tripState": plan,
            "operations": [{"type": "REMOVE", "activityId": plan["activities"][0]["id"]}]})
        record("stale-revision-rejected", bad.status_code == 409, http=bad.status_code)
        # Negative contract check: UTC is invalid for plan times even after the frontend fix.
        added = copy.deepcopy(plan["activities"][0])
        added.update(id="audit-added", orderIndex=3, startAt="2026-10-20T15:00:00+08:00", endAt="2026-10-20T08:00:00.000Z")
        bad = request("/api/v1/revisions/propose", {**ctx, "tripState": plan, "operations": [{"type": "ADD", "activity": added}]})
        record("reject-utc-plan-time", bad.status_code == 422, http=bad.status_code, errors=bad.json().get("errors"))
        cancel_body = {**ctx, "tripState": plan, "context": selected, "userRequest": "写一段简短提示。"}
        accepted = request("/api/v1/content/refine", cancel_body)
        if accepted.status_code == 202:
            job_id = accepted.json()["data"]["jobId"]
            cancelled = client.delete("/api/v1/jobs/"+job_id)
            after = request("/api/v1/jobs/"+job_id)
            record("cancel-job", cancelled.status_code == 200 and after.json()["data"]["status"] == "CANCELLED")
            samples.append({"case": "cancel", "schema": "CancelResult", "response": cancelled.json()})
        rid = uuid4().hex
        body = {"executionMode": "REAL", "city": "北京", "keyword": "天坛公园"}
        first, duplicate = request("/api/v1/places/search", body, rid), request("/api/v1/places/search", body, rid)
        conflict = request("/api/v1/places/search", {**body, "keyword": "故宫"}, rid)
        record("idempotency", first.status_code == duplicate.status_code == 200 and first.json() == duplicate.json() and conflict.status_code == 409)
        report["contentGenerated"] = bool(content and content.get("content", {}).get("body"))
        save()


if __name__ == "__main__":
    main()
