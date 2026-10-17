"""Live phone-backend acceptance using synthetic travel input and real configured providers.

Requires adb forward tcp:18761 tcp:18761. Never writes browser trip storage.
"""
import json
from pathlib import Path
import sys
import time
from uuid import uuid4
import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps/api'))
from app import schemas as s


def main():
    out = ROOT / 'output/android'
    out.mkdir(parents=True, exist_ok=True)
    result = {'evidence': 'LIVE_PHONE_BACKEND_REAL_PROVIDERS_SYNTHETIC_TRAVEL_INPUT', 'cases': []}
    context = {'executionMode': 'REAL', 'tripId': 'android-qa-' + uuid4().hex[:12], 'baseRevision': 0}

    def record(name, passed, **details):
        result['cases'].append({'case': name, 'pass': passed, **details})
        (out / 'phone-api.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result['cases'][-1], ensure_ascii=False), flush=True)
        if not passed:
            raise AssertionError(f'Phone acceptance failed: {name}; see output/android/phone-api.json')

    with httpx.Client(base_url='http://127.0.0.1:18761/api/v1', trust_env=False, timeout=50) as client:
        def job(name, path, body):
            start = time.monotonic()
            response = client.post(path, json=body, headers={'X-Request-Id': uuid4().hex})
            response.raise_for_status()
            accepted = response.json()
            job_id = accepted['data']['jobId']
            snapshot = accepted
            while time.monotonic() - start < 220:
                snapshot = client.get('/jobs/' + job_id).json()
                if snapshot['status'] in ('SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'):
                    break
                time.sleep(1)
            (out / f'{name}.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding='utf-8')
            passed = snapshot['status'] in ('SUCCEEDED', 'PARTIAL') and snapshot['data'].get('result') is not None
            record(name, passed, status=snapshot['status'], seconds=round(time.monotonic()-start, 1), errors=snapshot.get('errors', []))
            return snapshot['data'].get('result') if passed else None

        health = s.ApiResponse[s.HealthResult].model_validate(client.get('/health').json())
        record('health', health.data.serviceStatus == 'OK')
        parsed = job('parse-food-preference', '/requirements/parse', {**context,
            'text': '2026年10月20日一个人去杭州玩一天，09:00到18:00，公共交通和步行，预算人均1000元，喜欢西湖周边风景和杭州特色美食，中午餐馆由你推荐，不指定店名。'})
        if not parsed:
            return
        req = s.ParseRequirementsResult.model_validate(parsed).requirements
        record('unbound-food-does-not-block', not any(i.type == 'FOOD' and not i.placeId and not i.placeQuery for i in req.intents))
        req.confirmed = True
        req.version += 1
        generated = job('generate-with-dining', '/plans/generate', {**context, 'requirements': req.model_dump(exclude_none=True), 'mode': 'PLANNING'})
        if not generated:
            return
        plan_result = s.PlanResult.model_validate(generated)
        plan = plan_result.plan
        record('generated-plan', plan is not None and not plan_result.validation.hardViolations,
               validation=plan_result.validation.status, violations=[v.model_dump() for v in plan_result.validation.hardViolations],
               activities=[{'name': a.place.name, 'category': a.place.category, 'start': a.startAt, 'end': a.endAt} for a in plan.activities] if plan else [])
        if not plan:
            return
        record('automatic-dining', any(a.place.category == 'RESTAURANT' for a in plan.activities))
        nearby = job('nearby-food', '/nearby/search', {**context, 'tripState': plan.model_dump(exclude_none=True),
            'location': plan.activities[0].place.location.model_dump(), 'category': 'FOOD', 'preferences': ['杭州特色美食']})
        if nearby:
            candidates = s.NearbySearchResult.model_validate(nearby).candidates
            record('real-restaurants', len(candidates) >= 2 and all(c.place.category == 'RESTAURANT' for c in candidates),
                   restaurants=[{'name': c.place.name, 'category': c.place.category, 'distance': c.distanceMeters,
                      'averageCost': c.place.averageCostCny.value if c.place.averageCostCny else None,
                      'photos': len(c.place.photoUrls or [])} for c in candidates])
            snapshot = json.loads((out / 'nearby-food.json').read_text(encoding='utf-8'))
            stages = [e['agentId'] for e in snapshot['data']['progressEvents'] if e['type'] == 'agent_started']
            record('product-multi-agent-food', stages == ['A2', 'A3', 'A5', 'A2', 'A7'], stages=stages)
            routes = [c for c in candidates if c.route and c.route.evidence.status == 'VERIFIED' and c.route.durationMin is not None]
            record('real-walking-routes', bool(routes) and all(c.route.durationMin <= 30 for c in routes),
                   routes=[{'restaurant': c.place.name, 'minutes': c.route.durationMin, 'meters': c.route.distanceMeters,
                            'geometryPoints': len(c.route.routeGeometry or [])} for c in routes])
            record('review-source-boundaries', all(r.evidence.sourceUrl == r.url for c in candidates if c.reviewResearch for r in c.reviewResearch.references),
                   research=[{'restaurant': c.place.name, 'status': c.reviewResearch.status if c.reviewResearch else 'NOT_RUN',
                              'sources': len(c.reviewResearch.references) if c.reviewResearch else 0} for c in candidates])


if __name__ == '__main__':
    main()
