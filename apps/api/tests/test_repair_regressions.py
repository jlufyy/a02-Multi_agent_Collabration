"""TF-01..12 offline regressions. Synthetic inputs do not establish live service/GPS availability."""
import asyncio
import copy
import time

import httpx
import pytest

from app.gateway import ModelGateway
from app.planning import PlanningError, apply_operations, build_plan, reschedule
from app.providers import ProviderError
from app.jobs import dump
from app.validation import validate_plan
from test_api import env, generate, post, wait
from test_planning import plan, poi, requirements, routes


def test_67001_meter_893_minute_route_returns_report_instead_of_cross_day_exception():
    p = routes(plan(dailyEndTime="18:00"), 893.35)
    p.segments[0].distanceMeters = 67001
    candidate = reschedule(p)
    assert all(a.startAt.startswith('2026-10-20') for a in candidate.activities)
    report = validate_plan(candidate)
    assert report.status == 'INFEASIBLE'
    assert any(v.code == 'TRANSIT_INFEASIBLE' for v in report.hardViolations)


@pytest.mark.parametrize('mandatory', [False, True])
def test_generate_long_walk_is_bounded_or_explained(env, mandatory):
    client, maps, _, _ = env
    maps.minutes = 893.35
    req = dump(requirements(dailyEndTime='18:00', transportModes=['WALK']))
    if mandatory:
        req['mustVisit'] = [{'query': p['name'], 'place': p} for p in maps.places[:2]]
    out = wait(client, post(client, '/plans/generate', {'executionMode': 'REAL', 'tripId': 'long-walk', 'baseRevision': 0, 'requirements': req, 'mode': 'PLANNING'}))
    assert out['status'] in ('SUCCEEDED', 'PARTIAL'), out
    result = out['data']['result']
    assert result['validation']['status'] == ('INFEASIBLE' if mandatory else 'FEASIBLE')
    assert len([c for c in maps.calls if c[0] == 'route']) <= 8
    if mandatory:
        assert len(result['plan']['activities']) >= 2


def test_cross_day_duration_returns_readable_rejection_and_keeps_original():
    p = plan(1)
    before = p.model_dump_json()
    with pytest.raises(PlanningError, match='跨日'):
        apply_operations(p, [{'type': 'UPDATE_DURATION', 'activityId': p.activities[0].id, 'durationMin': 1440}])
    assert p.model_dump_json() == before


def test_verified_parent_grouping_preserves_explicit_visits_and_does_not_guess_from_name():
    parent = poi('a', '景区')
    child = poi('b', '景区内部')
    sibling = poi('c', '别名')
    child['parentPoiId'] = {'value': 'a', 'evidence': parent['evidence'][0]}
    sibling['parentPoiId'] = copy.deepcopy(child['parentPoiId'])
    assert len(build_plan('group', requirements(), [parent, child, sibling]).activities) == 1
    req = requirements(mustVisit=[{'query': p['name'], 'place': p} for p in (parent, child)])
    assert {a.place.poiId for a in build_plan('group', req, [parent, child, sibling]).activities} == {'a', 'b'}
    child.pop('parentPoiId')
    assert len(build_plan('group', requirements(), [parent, child]).activities) == 2


def test_multiturn_updates_only_declared_fields_keeps_poi_and_stable_identity(env):
    client, maps, gateway, _ = env
    old = dump(requirements(mustVisit=[{'query': maps.places[0]['name'], 'place': maps.places[0]}]))
    old['confirmed'] = False
    extracted = dump(requirements(travelerCount=3, preferences=['不应覆盖旧偏好']))
    extracted['confirmed'] = False
    gateway.reply = {'requirements': extracted, 'changedFields': ['travelerCount'], 'fieldSources': {'travelerCount': 'USER'}}
    out = wait(client, post(client, '/requirements/parse', {'executionMode': 'REAL', 'tripId': 'chat', 'baseRevision': 0,
        'text': '我们一共三个人', 'requirements': old, 'conversation': [{'role': 'user', 'content': '去北京一天'}]}))
    assert out['status'] == 'SUCCEEDED', out
    r = out['data']['result']['requirements']
    assert r['travelerCount'] == 3 and r['requirementsId'] == old['requirementsId']
    assert r['version'] == old['version']+1
    assert r['mustVisit'] == old['mustVisit'] and r['preferences'] == old['preferences']
    assert not r['confirmed']


def test_inferred_transport_is_visible_and_key_questions_are_bounded(env):
    client, _, gateway, _ = env
    req = dump(requirements())
    req.pop('startDate')
    req.pop('endDate')
    req.pop('travelerCount')
    req['confirmed'] = False
    gateway.reply = {'requirements': req, 'fieldSources': {'transportModes': 'SUGGESTED'}, 'questions': ['预算多少？']}
    out = wait(client, post(client, '/requirements/parse', {'executionMode': 'REAL', 'tripId': 'chat', 'baseRevision': 0, 'text': '去北京'}))
    r = out['data']['result']
    assert len(r['questions']) == 2
    assert any(u['fieldPath'] == 'transportModes' for u in r['uncertainFields'])
    assert r['questions'][0] == '准备哪天出发？'


@pytest.mark.asyncio
async def test_content_total_deadline_caps_retries_and_wall_time():
    calls = []
    async def stalled(request):
        calls.append(request)
        await asyncio.sleep(.2)
        return httpx.Response(200, json={})
    async with httpx.AsyncClient(transport=httpx.MockTransport(stalled)) as client:
        gateway = ModelGateway({'p': {'kind': 'openai-compatible', 'base_url': 'https://synthetic.invalid', 'api_key': 'synthetic', 'model': 'test'}},
            {'A7': 'p'}, client=client, max_retries=2, role_limits={'A7': {'timeout_seconds': .02, 'max_tokens': 800}})
        started = time.monotonic()
        with pytest.raises(ProviderError) as caught:
            await gateway.generate_structured('A7', {'type': 'object'}, {}, job_id='deadline')
        assert caught.value.code == 'LLM_TIMEOUT'
        assert time.monotonic()-started < .15
        assert len(calls) == 1
        assert b'800' in calls[0].content


def test_local_edit_reuses_unchanged_routes_but_final_audit_refreshes(env):
    from test_api import context
    client, maps, _, _ = env
    p = generate(client)['data']['result']['plan']
    before = len([c for c in maps.calls if c[0] == 'route'])
    result = wait(client, post(client, '/revisions/propose', context(p, operations=[{'type': 'UPDATE_DURATION', 'activityId': p['activities'][-1]['id'], 'durationMin': 100}])))
    proposal = result['data']['result']['proposal']
    after_preview = len([c for c in maps.calls if c[0] == 'route'])
    assert after_preview == before
    final = wait(client, post(client, '/revisions/validate', context(p, proposal=proposal)))
    assert final['data']['result']['validation']['committable']
    assert len([c for c in maps.calls if c[0] == 'route']) > after_preview


@pytest.mark.parametrize('progress', ['ARRIVED', 'VISITING', 'INFERRED_COMPLETE'])
def test_in_progress_and_completed_stops_are_protected(progress):
    p = plan()
    p.activities[0].progress = progress
    with pytest.raises(PlanningError) as caught:
        apply_operations(p, [{'type': 'REMOVE', 'activityId': p.activities[0].id}])
    assert caught.value.code == 'ACTIVITY_PROGRESS_PROTECTED'


def test_changed_route_returns_updated_proposal_for_one_new_summary(env):
    from test_api import context
    client, maps, _, _ = env
    p = generate(client)['data']['result']['plan']
    proposed = wait(client, post(client, '/revisions/propose', context(p, operations=[{'type': 'UPDATE_DURATION', 'activityId': p['activities'][0]['id'], 'durationMin': 100}])))['data']['result']['proposal']
    maps.minutes += 5
    result = wait(client, post(client, '/revisions/validate', context(p, proposal=proposed)))['data']['result']
    assert not result['validation']['committable']
    replacement = result['replacementProposal']
    assert replacement['operations'] == proposed['operations']
    assert replacement['proposalId'] != proposed['proposalId']
    assert replacement['baseRevision'] == p['revision']
    checked = wait(client, post(client, '/revisions/validate', context(p, proposal=replacement)))['data']['result']
    assert checked['validation']['committable']


def test_fixed_visit_outside_trip_dates_is_an_explained_infeasible_result(env):
    client, maps, _, _ = env
    req = dump(requirements(fixedConstraints=[{'id': 'outside', 'place': {'query': maps.places[0]['name'], 'place': maps.places[0]}, 'startAt': '2026-10-21T12:00:00+08:00', 'reason': '合成边界测试', 'locked': True}]))
    out = wait(client, post(client, '/plans/generate', {'executionMode': 'REAL', 'tripId': 'fixed-boundary', 'baseRevision': 0, 'requirements': req, 'mode': 'PLANNING'}))
    assert out['status'] == 'PARTIAL', out
    assert out['data']['result']['validation']['status'] == 'INFEASIBLE'
    assert out['data']['result']['validation']['hardViolations'][0]['code'] == 'TIME_WINDOW_VIOLATION'
