"""Synthetic restaurant regressions; not real shop/price/opening-hour evidence."""
import asyncio
import httpx

from app.providers import AmapProvider
from app.planning import build_plan
from app.workflows import dining_keyword, normalize_dining
from test_planning import poi, requirements


def restaurant(pid='food', cost=45):
    p = poi(pid, '合成餐馆')
    p['category'] = 'RESTAURANT'
    p['averageCostCny'] = {'value': cost, 'evidence': {**p['evidence'][0], 'status': 'ESTIMATED'}}
    p.pop('ticketPriceCny')
    return p


def test_food_intent_does_not_become_a_scenic_keyword():
    assert dining_keyword(['历史', '美食', '推荐附近有什么好吃的']) == ''
    assert dining_keyword(['推荐附近的火锅餐馆']) == '火锅'


def test_unbound_food_request_is_a_preference_while_a_named_restaurant_stays_a_task():
    intent = {'id': 'food-intent', 'type': 'FOOD', 'status': 'PENDING', 'userRequest': '中午吃杭州特色美食', 'locked': False}
    req = {'preferences': ['风景'], 'intents': [intent, {**intent, 'id': 'area', 'placeQuery': '北湖公园附近餐厅'}, {**intent, 'id': 'named', 'placeQuery': '合成餐馆'}]}
    out = normalize_dining(req)
    assert out['preferences'] == ['风景', '中午吃杭州特色美食']
    assert [i['id'] for i in out['intents']] == ['named']
    assert len(req['intents']) == 3


def test_real_adapter_filters_category_and_keeps_spending_separate_from_tickets():
    async def run():
        def respond(request):
            assert request.url.params['types'] == '050100|050200|050300'
            return httpx.Response(200, json={'status': '1', 'pois': [
                {'id': 'f', 'name': '合成餐馆', 'typecode': '050100', 'location': '116.4,39.9', 'biz_ext': {'cost': '45', 'rating': '4.5'}},
                {'id': 'c', 'name': '合成茶馆', 'typecode': '050600', 'location': '116.4,39.9'},
                {'id': 'a', 'name': '合成景点', 'typecode': '110000', 'location': '116.4,39.9'}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            maps = AmapProvider('synthetic-key', client=client)
            places = await maps.nearby_pois(poi()['location'], types='050000')
            assert len(places) == 1
            assert places[0]['category'] == 'RESTAURANT'
            assert places[0]['averageCostCny']['value'] == 45
            assert places[0]['averageCostCny']['evidence']['status'] == 'ESTIMATED'
            assert places[0]['ticketPriceCny']['evidence']['status'] == 'UNKNOWN'
    asyncio.run(run())


def test_nearby_meal_is_added_without_displacing_sightseeing_and_cost_is_group_estimate():
    p = build_plan('trip', requirements(), [poi(str(i)) for i in range(4)] + [restaurant()])
    assert len([a for a in p.activities if a.place.category != 'RESTAURANT']) == 4
    food = [a for a in p.activities if a.place.category == 'RESTAURANT']
    assert len(food) == 1
    assert food[0].estimatedCostCny == 90
    assert food[0].costStatus == 'ESTIMATED'
    assert food[0].startAt[11:16] >= '11:30'
    assert [a.orderIndex for a in p.activities] == list(range(5))
    assert all(a.endAt <= b.startAt for a, b in zip(p.activities, p.activities[1:]))


def test_optional_meal_respects_avoid_distance_and_budget():
    r = restaurant()
    for req, food in [
        (requirements(avoidPlaces=[{'query': r['name'], 'place': r}]), r),
        (requirements(), {**r, 'location': {**r['location'], 'lat': 40.9}}),
        (requirements(budgetCny=50), r),
    ]:
        p = build_plan('trip', req, [poi('s')] + [food])
        assert all(a.place.category != 'RESTAURANT' for a in p.activities)


def test_dinner_request_is_scheduled_in_evening():
    p = build_plan('trip', requirements(preferences=['公园附近吃晚饭']), [poi('s'), restaurant()])
    meal = next(a for a in p.activities if a.place.category == 'RESTAURANT')
    assert meal.startAt[11:16] == '17:30'
