"""Opt-in real verification. Reads configured secrets privately; writes only safe summaries.

Run from repo root: python apps/api/scripts/live_verify.py
This calls real paid model/map APIs, bounded by Settings and ModelGateway limits.
"""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import subprocess
from datetime import date, timedelta
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/api"))
from app.config import Settings
from app.gateway import ModelGateway
from app.providers import AmapProvider, ProviderError
from app.workflows import Workflows, ContentDraft
from app.jobs import Job, dump
from app import schemas as s


class RecordingGateway(ModelGateway):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.observed_usage = []

    async def generate_structured(self, role, schema, payload, job_id="default"):
        result = await super().generate_structured(role, schema, payload, job_id)
        self.observed_usage.append({"agentId": role, **result.usage})
        return result


async def main():
    settings = Settings.from_env()
    maps = AmapProvider(settings.amap_key)
    gateway = RecordingGateway(settings.provider_configs, settings.role_routes, timeout_seconds=60,
                           daily_budget_cny=settings.daily_budget_cny)
    workflow = Workflows(maps, gateway)
    records = []
    def record(case, passed, **fields):
        item = {"case": case, "status": "PASS" if passed else "FAIL", **fields}
        records.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    def job():
        return Job(uuid4().hex, uuid4().hex, uuid4().hex, {}, status="RUNNING")
    try:
        found = {}
        for city, query in (("北京", "天坛公园"), ("北京", "天安门"), ("上海", "豫园")):
            places = await maps.search_pois(query, city=city)
            found[query] = places
            record("poi-"+query, bool(places), count=len(places), exactNames=[p["name"] for p in places[:5]])
        if found["天坛公园"] and found["天安门"]:
            a, b = found["天坛公园"][0], found["天安门"][0]
            for mode in ("WALK", "TRANSIT", "DRIVE"):
                try:
                    route = await maps.routes(a["location"], b["location"], mode, city="北京")
                    record("route-"+mode, route["evidence"]["status"] == "VERIFIED", durationMin=route.get("durationMin"), geometryPoints=len(route.get("routeGeometry", [])))
                except ProviderError as exc:
                    record("route-"+mode, False, errorCode=exc.code, message=exc.message)
        text = "2026年10月20日至21日，两人北京旅行，总预算1500元，不含住宿和城际交通。每天9点到18点，公交和步行，必须去天坛公园和天安门。我们喜欢历史和拍照，想在天安门拍一段纪念旅行的演讲视频。"
        parse_req = s.ParseRequirementsRequest(tripId="live-check", baseRevision=0, executionMode="REAL", text=text)
        parsed, _ = await workflow.parse(parse_req, job())
        record("A1-parse", not parsed.requirements.confirmed and parsed.requirements.destinationCity == "北京", intentCount=len(parsed.intents), missingFields=parsed.missingFields)
        raw = dump(parsed.requirements)
        raw.update(confirmed=True, startDate="2026-10-20", endDate="2026-10-21", travelerCount=2,
                   destinationCity="北京", transportModes=["TRANSIT", "WALK"])
        # This script explicitly selects the returned POIs, exactly like a user-confirmed form.
        raw["mustVisit"] = [{"query": name, "place": found[name][0]} for name in ("天坛公园", "天安门") if found[name]]
        for intent in raw["intents"]:
            intent["confirmed"] = True
            intent["placeId"] = found["天安门"][0]["poiId"]
            intent["placeQuery"] = "天安门"
        req = s.GeneratePlanRequest(tripId="live-check", baseRevision=0, executionMode="REAL", mode="PLANNING", requirements=raw)
        plan_job = job()
        result, partial = await workflow.generate(req, plan_job)
        record("P1-real-plan", result.plan is not None and result.validation.committable,
               validation=dump(result.validation), activityCount=len(result.plan.activities) if result.plan else 0,
               contentCount=len(result.preparedContents), agents=sorted({e["agentId"] for e in plan_job.events}))
        if result.plan:
            plan = result.plan
            selected = s.SelectedContext(tripId=plan.tripId, planRevision=plan.revision, mode=plan.mode, activeDay=0, selectedActivityId=plan.activities[0].id)
            content = await workflow.content(plan, __import__('app.agents', fromlist=['AgentRunner']).AgentRunner(job()), selected=selected, user_request="请给一个简短的参观观察提纲，不编造资料。")
            record("A7-second-model", bool(content.body), contentChars=len(content.body))
            first = plan.activities[0]
            proposal_req = s.ProposeRevisionRequest(**{"tripId": plan.tripId, "baseRevision": plan.revision, "executionMode": "REAL", "tripState": dump(plan),
                                                     "operations": [{"type": "UPDATE_DURATION", "activityId": first.id, "durationMin": 60}]})
            revision, _ = await workflow.propose(proposal_req, job())
            record("P2-real-proposal", revision.kind == "REVISION", committable=revision.proposal.validation.committable)
            validation_req = s.ValidateRevisionRequest(tripId=plan.tripId, baseRevision=plan.revision, executionMode="REAL", tripState=plan, proposal=revision.proposal)
            final, _ = await workflow.validate(validation_req, job())
            safe_reproposal = not final.validation.committable and any("REPROPOSE_REQUIRED" in v for v in final.validation.unknownChecks)
            record("P2-final-recheck", bool(final.validation.committable) or safe_reproposal, committable=final.validation.committable,
                   safelyRequiresReproposal=safe_reproposal, validation=dump(final.validation))
            if plan.intents:
                raw_trip = dump(plan)
                raw_trip.update(mode="TRAVELING", lifecycle="TRAVELING")
                target = next(a for a in raw_trip["activities"] if a["id"] == raw_trip["intents"][0]["activityId"])
                # Exercise the identical browser state machine; never shortcut a fake ARRIVE button.
                javascript = """
import {createGeoEngineState, processLocation} from './packages/context-engine/index.mjs';
let chunks='';for await(const c of process.stdin)chunks+=c;
const x=JSON.parse(chunks); let state=createGeoEngineState({tripId:x.trip.tripId,source:'SIMULATED',demoRunId:'live-demo'});
let events=[]; for(const offset of [0,45,90]){
const sample={sampleId:'s'+offset,tripId:x.trip.tripId,source:'SIMULATED',demoRunId:'live-demo',location:x.target.place.location,
accuracyMeters:10,timestamp:new Date(Date.parse(x.target.startAt)+offset*1000).toISOString(),pageVisible:true};
const r=processLocation({sample,activities:x.trip.activities,state,revision:x.trip.revision,policy:x.policy});state=r.state;events.push(...r.events);}
process.stdout.write(JSON.stringify(events.find(e=>e.type==='ARRIVE')||null));
"""
                simulation = subprocess.run(["node", "--input-type=module", "-e", javascript], cwd=ROOT,
                    input=json.dumps({"trip": raw_trip, "target": target, "policy": json.loads((ROOT/"packages/context-engine/geo-policy.json").read_text())}),
                    capture_output=True, text=True, encoding="utf-8", check=True)
                event = json.loads(simulation.stdout)
                target["progress"] = "ARRIVED"
                proactive_req = s.EvaluateProactiveRequest(tripId=plan.tripId, baseRevision=plan.revision, executionMode="DEMO", demoRunId="live-demo",
                        tripState=raw_trip, currentEvent=event, recentNotifications=[], uiBusy=False)
                active, _ = await workflow.proactive(proactive_req, job())
                record("P3-simulated-arrival-real-model", active.decision.shouldNotify and bool(active.contents),
                       eventSource="SIMULATED", usedBrowserStateMachine=True, cardLevel=active.decision.card.level if active.decision.card else None)
        # Explicit confirmed requirements test other day counts/city without extra model calls.
        for city, days, query in (("北京", 1, "天坛公园"), ("上海", 3, "豫园")):
            req_data = {"requirementsId": uuid4().hex, "version": 1, "confirmed": True, "destinationCity": city,
                        "startDate": "2026-10-20", "endDate": (date(2026,10,20)+timedelta(days=days-1)).isoformat(),
                        "timezone": "Asia/Shanghai", "travelerCount": 2, "budgetIsHardLimit": False,
                        "transportModes": ["TRANSIT", "WALK"], "mustVisit": [{"query": query, "place": found[query][0]}],
                        "avoidPlaces": [], "preferences": ["公园"], "companions": [], "specialNeeds": [], "fixedConstraints": [], "intents": []}
            generated, _ = await workflow.generate(s.GeneratePlanRequest(tripId="live-"+city+str(days), baseRevision=0, executionMode="REAL", mode="PLANNING", requirements=req_data), job())
            record(f"city-days-{city}-{days}", bool(generated.plan) and generated.validation.committable,
                   daysCovered=len({a.dayIndex for a in generated.plan.activities}), validationStatus=generated.validation.status,
                   hardCodes=[v.code for v in generated.validation.hardViolations], unknownCount=len(generated.validation.unknownChecks))
    except ProviderError as exc:
        record("upstream-failure", False, errorCode=exc.code, message=exc.message)
    except Exception as exc:
        record("workflow-error", False, exceptionType=type(exc).__name__)
        # Validation errors contain supplied test data only but still keep the persisted report minimal.
        if isinstance(exc, __import__('pydantic').ValidationError):
            print(json.dumps([{"loc": e["loc"], "type": e["type"], "msg": e["msg"]} for e in exc.errors()], ensure_ascii=False), flush=True)
    finally:
        await maps.aclose()
        await gateway.aclose()
        report = {"timestamp": datetime.now(timezone.utc).isoformat(), "evidenceType": "LIVE_API_WITH_EXPLICIT_SIMULATED_LOCATION_CASE", "records": records,
                  "modelCalls": gateway.observed_usage,
                  "notes": ["AIPing is one aggregator; two model families are not proof of two independent contracted API suppliers.",
                            "No secret, full provider response, raw location track, or full POI database is stored in this report."]}
        (ROOT / "docs/live-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
