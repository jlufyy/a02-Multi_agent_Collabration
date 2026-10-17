"""Synthetic regressions for real-provider field handling and travel UX."""
import asyncio
import copy

import httpx
import pytest

from app.place_facts import TICKET_SOURCES, opening_windows, verify_ticket
from app.providers import AmapProvider, ProviderError
from app.workflows import Workflows
from test_planning import poi, requirements, build_plan
from test_api import env, generate, post, wait, context


@pytest.mark.parametrize("policy,day,expected", [
    ("周一至周日 08:00-20:00 最晚进入19:00", "2026-10-20", [(480, 1200)]),
    ("周一至周日 00:00-24:00", "2026-10-20", [(0, 1440)]),
    ("4月1日至10月31日 周二至周日 08:30-17:00 16:00停止检票，11月1日至3月31日 周二至周日 08:30-16:30 15:30停止检票", "2026-11-03", [(510, 990)]),
    ("周二至周日 08:30-17:00", "2026-10-19", []),
    ("周二至周日 08:30-17:00 节假日营业时间以官方通知为准", "2026-10-19", None),
    ("1月至3月,11月至12月 周一至周日 06:30-19:00 最晚进入18:00；4月至10月 周一至周日 06:00-20:00 最晚进入19:00", "2026-11-03", [(390, 1140)]),
    ("06:00-17:30（17:00停售停检）", "2026-10-20", [(360, 1050)]),
])
def test_date_aware_opening(policy, day, expected):
    assert opening_windows(policy, day) == expected


def test_map_listing_keeps_hours_photos_without_using_average_spend_as_ticket():
    p = AmapProvider()
    place = p._place({"id": "p", "name": "synthetic", "location": "116.4,39.9",
        "biz_ext": {"opentime2": "周一至周日 08:00-20:00", "cost": "300"}, "photos": [
            {"url": "http://store.is.autonavi.com/showpic/synthetic"},
            {"url": "https://evil.example/image"}, {"url": "https://store.is.autonavi.com.evil.example/image"}]}, "2026-10-17T00:00:00Z", "test")
    assert place["openingHours"]["evidence"]["status"] == "VERIFIED"
    assert place["photoUrls"] == ["https://store.is.autonavi.com/showpic/synthetic"]
    assert place["ticketPriceCny"]["evidence"]["status"] == "UNKNOWN"
    asyncio.run(p.aclose())


def test_official_ticket_is_date_specific_and_failure_never_becomes_free():
    async def run():
        place = poi("real", "故宫博物院")
        place.pop("ticketPriceCny")
        original = copy.deepcopy(place)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200,
                text="故宫博物院 旺季，大门票60元/人；淡季，大门票40元/人；学生票20元"))) as client:
            peak = await verify_ticket(place, "2026-10-20", client)
            low = await verify_ticket(place, "2026-11-03", client)
            assert peak["ticketPriceCny"]["value"] == 60
            assert low["ticketPriceCny"]["value"] == 40
            assert low["ticketPriceCny"]["evidence"]["sourceUrl"] == TICKET_SOURCES["故宫博物院"][0]
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(403))) as client:
            assert "ticketPriceCny" not in await verify_ticket(place, "2026-10-20", client)
            third_party = [{"url": "https://example.org/fake", "snippet": "旺季大门票1元", "evidence": {}}]
            assert "ticketPriceCny" not in await verify_ticket(place, "2026-10-20", client, third_party)
        assert place == original
    asyncio.run(run())


def test_fastest_permitted_route_and_failure_fallback():
    async def run():
        class Maps:
            async def routes(self, origin, destination, mode, **kwargs):
                if mode == "TRANSIT":
                    raise ProviderError("API_UNAVAILABLE", "synthetic failure")
                return {"mode": mode, "durationMin": 20 if mode == "DRIVE" else 180,
                        "evidence": {"provider": "synthetic", "status": "VERIFIED"}}
        req = requirements(transportModes=["WALK", "TRANSIT", "DRIVE"])
        plan = build_plan("trip", req, [poi("a"), poi("b")])
        result = await Workflows(Maps(), None).route_segments(req, plan.activities, "WALK")
        assert result.segments[0].mode == "DRIVE"
        assert result.segments[0].durationMin == 20
    asyncio.run(run())


def test_remote_required_site_gets_its_own_day_and_nearby_stops_fill_city_day():
    places = [poi(str(i)) for i in range(8)]
    places[0]["location"]["lat"] = 40.35
    req = requirements(days=2, mustVisit=[{"query": places[0]["name"], "place": places[0]}])
    plan = build_plan("trip", req, places)
    remote = next(a for a in plan.activities if a.place.poiId == "0")
    assert remote.mandatory
    assert len([a for a in plan.activities if a.dayIndex != remote.dayIndex]) == 4
    assert len([a for a in plan.activities if a.dayIndex == remote.dayIndex]) == 1


@pytest.mark.parametrize("increase,committable", [(1, True), (100, False)])
def test_live_route_jitter_can_confirm_but_material_changes_require_preview(env, increase, committable):
    client, maps, _, _ = env
    plan = generate(client)["data"]["result"]["plan"]
    proposal = wait(client, post(client, "/revisions/propose", context(plan, operations=[
        {"type": "UPDATE_DURATION", "activityId": plan["activities"][0]["id"], "durationMin": 60}])))["data"]["result"]["proposal"]
    maps.minutes += increase
    result = wait(client, post(client, "/revisions/validate", context(plan, proposal=proposal)))["data"]["result"]
    assert result["validation"]["committable"] is committable
    if committable:
        assert not result.get("replacementProposal")
    else:
        assert any(c.startswith("REPROPOSE_REQUIRED") for c in result["validation"]["unknownChecks"])
