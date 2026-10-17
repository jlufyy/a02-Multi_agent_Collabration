"""Location confirmation regressions; synthetic POI fixtures, not live evidence."""
import copy
import pytest
from app.jobs import dump
from app.place_matching import unique_place
from test_api import env, context, post, wait
from test_planning import poi, requirements


@pytest.mark.parametrize('query,name,address', [
    ('吉林大学南湖校区', '吉林大学(南湖校区)', '南湖大路5372号'),
    ('长春市吉林大学（南湖校区）', '吉林大学(南湖校区)', ''),
    ('北湖公园', '长春北湖湿地公园', ''),
    ('长春市北湖公园', '长春北湖湿地公园', ''),
    ('长春市龙翔国际商务中心大金球', '大金球', '龙翔国际商务中心'),
])
def test_equivalent_user_names_match_real_candidate_without_dropping_branch_words(query, name, address):
    place = {**poi('main', name), 'address': address}
    noise = [poi('gate', name+'(东门)'), poi('parking', name+'停车场'), poi('other', '吉林大学(中心校区)')]
    assert unique_place(query, noise+[place], '长春')['poiId'] == 'main'


def test_ambiguity_and_different_campuses_are_never_silently_rebound():
    assert unique_place('吉林大学南湖校区', [poi('other', '吉林大学(中心校区)')], '长春') is None
    assert unique_place('北湖公园', [poi('wetland', '北湖湿地公园'), poi('forest', '北湖森林公园')], '长春') is None
    assert unique_place('大学', [poi('a', '大学'), poi('b', '大学')], '长春') is None
    assert unique_place('北湖公园', [poi('stop', '北湖公园(公交站)'), poi('gate', '北湖公园(东门)')], '长春') is None


def location_requirements():
    raw = dump(requirements())
    raw.update(destinationCity='长春', confirmed=False, startPoint={'query': '吉林大学南湖校区'},
               endPoint={'query': '吉林大学南湖校区'}, mustVisit=[{'query': '北湖公园'}],
               avoidPlaces=[{'query': '合成避开点'}], fixedConstraints=[{'id': 'f', 'startAt': '2026-10-20T15:00:00+08:00',
                   'reason': '合成集合', 'locked': True, 'place': {'query': '合成集合点'}}])
    return raw


def test_chat_resolves_every_location_before_summary_confirmation(env):
    client, maps, gateway, _ = env
    raw = location_requirements()
    maps.places = [poi('campus', '吉林大学(南湖校区)'), poi('park', '长春北湖湿地公园'),
                   poi('avoid', '合成避开点'), poi('fixed', '合成集合点')]
    gateway.reply = {'requirements': raw}
    result = wait(client, post(client, '/requirements/parse', context(text='合成地点需求')))
    assert result['status'] == 'SUCCEEDED', result
    r = result['data']['result']['requirements']
    assert r['startPoint']['place']['poiId'] == r['endPoint']['place']['poiId'] == 'campus'
    assert r['mustVisit'][0]['place']['poiId'] == 'park'
    assert r['avoidPlaces'][0]['place']['poiId'] == 'avoid'
    assert r['fixedConstraints'][0]['place']['place']['poiId'] == 'fixed'
    assert not result['data']['result']['uncertainFields']
    assert maps.calls.count(('search', '吉林大学南湖校区')) == 1


def test_preflight_repairs_old_draft_without_a_model_call_or_changing_user_conditions(env):
    client, maps, gateway, _ = env
    raw = location_requirements()
    maps.places = [poi('campus', '吉林大学(南湖校区)'), poi('park', '长春北湖湿地公园'),
                   poi('avoid', '合成避开点'), poi('fixed', '合成集合点')]
    async def forbidden(*args, **kwargs):
        raise AssertionError('Place preflight must not invoke an LLM')
    gateway.generate_structured = forbidden
    before = copy.deepcopy(raw)
    result = wait(client, post(client, '/requirements/resolve-places', context(requirements=raw)))
    assert result['status'] == 'SUCCEEDED', result
    r = result['data']['result']['requirements']
    assert r['startPoint']['place']['poiId'] == 'campus'
    for key in ('startPoint', 'endPoint'):
        r[key].pop('place')
    for key in ('mustVisit', 'avoidPlaces'):
        for ref in r[key]: ref.pop('place')
    r['fixedConstraints'][0]['place'].pop('place')
    assert r == before
    assert [e['agentId'] for e in result['data']['progressEvents'] if e['type'] == 'agent_started'] == ['A2']


def test_preflight_returns_candidates_for_boundary_ambiguity_instead_of_planning_failure(env):
    client, maps, _, _ = env
    raw = dump(requirements(startPoint={'query': '合成同名大学'}))
    maps.places = [poi('a', '合成同名大学'), poi('b', '合成同名大学')]
    result = wait(client, post(client, '/requirements/resolve-places', context(requirements=raw)))
    assert result['status'] == 'PARTIAL', result
    data = result['data']['result']
    assert 'place' not in data['requirements']['startPoint']
    assert data['uncertainFields'][0]['fieldPath'] == 'startPoint'
    assert len(data['uncertainFields'][0]['candidates']) == 2


def test_old_confirmed_requirements_can_generate_with_canonical_boundary_names(env):
    client, maps, _, _ = env
    campus = poi('campus', '合成大学(南湖校区)')
    maps.places.append(campus)
    raw = dump(requirements(startPoint={'query': '合成大学南湖校区'}, endPoint={'query': '合成大学南湖校区'}))
    result = wait(client, post(client, '/plans/generate', context(requirements=raw, mode='PLANNING')))
    assert result['status'] in ('SUCCEEDED', 'PARTIAL'), result
    assert result['data']['result']['plan']['requirements']['endPoint']['place']['poiId'] == 'campus'
