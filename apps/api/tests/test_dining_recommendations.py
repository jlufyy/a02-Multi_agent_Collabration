"""Synthetic evidence for the product's A2/A3/A5/A7 food workflow, not live shop reviews."""
import copy
import json
import asyncio
import httpx

from app import schemas as s
from app.jobs import dump
from app.dining import audit_candidates, cuisine_query
from app.web_search import WebSearchProvider, food_reference_matches
from test_api import env, generate, context, post, wait
from test_dining import restaurant


def test_agents_cooperate_and_real_walk_limit_rejects_a_nearby_but_inaccessible_shop(env):
    client, maps, _, _ = env
    plan = generate(client)['data']['result']['plan']
    near, detour = restaurant('near'), restaurant('detour')
    detour['location']['lat'] += .001
    async def nearby(*args, **kwargs):
        assert kwargs['types'] == '050000' and kwargs['radius_m'] == 2000
        assert kwargs['query'] == '湘菜'
        return copy.deepcopy([near, detour])
    async def routes(origin, destination, mode, **kwargs):
        assert mode == 'WALK'
        return {'mode': mode, 'durationMin': 55 if destination['lat'] == detour['location']['lat'] else 8,
                'distanceMeters': 4000 if destination['lat'] == detour['location']['lat'] else 500,
                'routeGeometry': [origin, destination], 'evidence': near['evidence'][0]}
    maps.nearby_pois, maps.routes = nearby, routes
    result = wait(client, post(client, '/nearby/search', context(plan, location=near['location'], category='FOOD',
        preferences=['湖南菜'], radiusMeters=2000, maxWalkMinutes=20)))
    assert result['status'] == 'PARTIAL'
    data = result['data']['result']
    assert [c['place']['poiId'] for c in data['candidates']] == ['near']
    assert data['candidates'][0]['route']['durationMin'] == 8
    assert data['candidates'][0]['estimatedCostCny'] == 90
    assert 'ticketPriceCny' not in data['candidates'][0]['place']
    stages = [e['agentId'] for e in result['data']['progressEvents'] if e['type'] == 'agent_started']
    assert stages == ['A2', 'A3', 'A5', 'A2', 'A7']
    assert any('已排除 1' in n for n in data['notes'])


def test_review_matching_rejects_same_brand_other_branch_and_city():
    place = {'name': '合成湘菜馆(北湖吾悦店)', 'address': '北远达大街9888号'}
    assert food_reference_matches(place, '长春', '长春合成湘菜馆 北湖吾悦店 顾客评价')
    assert not food_reference_matches(place, '长春', '长春合成湘菜馆 南湖店 顾客评价')
    assert not food_reference_matches(place, '长春', '合成湘菜馆 北湖吾悦店 北京 顾客评价')


def test_food_search_keeps_only_branch_bound_sources_and_does_not_create_review_authors():
    async def run():
        place = {**restaurant(), 'name': '合成湘菜馆(北湖吾悦店)', 'address': '北远达大街9888号'}
        def handler(request):
            query = json.loads(request.content)['query']
            assert '顾客评价' in query and '北远达大街' in query
            return httpx.Response(200, json={'results': [
                {'title': '长春合成湘菜馆 北湖吾悦店', 'url': 'https://example.org/right', 'content': '合成搜索测试摘要：口味和环境讨论。'},
                {'title': '长春合成湘菜馆 南湖店', 'url': 'https://example.org/wrong', 'content': '其他分店资料。'}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            search = WebSearchProvider('tavily', 'synthetic-private-key', client=client)
            answer = s.WebResearch.model_validate(await search.research(place, city='长春', purpose='FOOD'))
            assert [r.url for r in answer.references] == ['https://example.org/right']
            assert answer.references[0].evidence.status == 'ESTIMATED'
            assert 'synthetic-private-key' not in json.dumps(dump(answer))
            assert not any(k in dump(answer.references[0]) for k in ['author', 'reviewCount', 'score'])
    asyncio.run(run())


def test_budget_and_unknown_walk_are_explicit_without_turning_estimates_into_verified_facts():
    place = restaurant()
    candidate = {'place': place, 'distanceMeters': 100, 'distanceEvidence': place['evidence'][0],
        'relevanceReason': '合成测试', 'costStatus': 'ESTIMATED', 'estimatedCostCny': 90}
    from test_planning import plan
    p = plan()
    request = s.NearbySearchRequest.model_validate({**context(dump(p), location=place['location'], category='FOOD', preferences=[]), 'maxAverageCostCny': 20})
    assert not audit_candidates({'candidates': [candidate], 'notes': []}, request)['candidates']
    request.maxAverageCostCny = None
    accepted = audit_candidates({'candidates': [candidate], 'notes': []}, request)['candidates'][0]
    assert '步行路线暂未核验' in accepted['relevanceReason']
    assert 'route' not in accepted
    assert cuisine_query(['想吃湖南菜或者湘菜']) == '湘菜'
