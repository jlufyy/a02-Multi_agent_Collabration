"""Regression for boundaries discovered by real-provider verification."""
from app.planning import reschedule
from app.validation import validate_plan
from test_planning import plan, routes
from test_api import env, generate, context, post, wait


def test_fractional_provider_seconds_never_round_schedule_earlier():
    p = routes(plan(), minutes=49.88333333333333)
    candidate = reschedule(p)
    assert not any(v.code == "TRANSIT_INFEASIBLE" for v in validate_plan(candidate).hardViolations)


def test_locked_edit_is_atomic_noncommittable_proposal(env):
    client, _, _, _ = env
    plan = generate(client)["data"]["result"]["plan"]
    plan["activities"][0]["locked"] = True
    result = wait(client, post(client, "/revisions/propose", context(plan, operations=[
        {"type": "REMOVE", "activityId": plan["activities"][0]["id"]}])))
    assert result["status"] == "PARTIAL", result
    proposal = result["data"]["result"]["proposal"]
    assert not proposal["validation"]["committable"]
    assert proposal["candidate"] == plan


def test_unknown_route_falls_back_only_to_user_allowed_mode(env):
    client, maps, _, _ = env
    original = maps.routes
    async def no_transit(origin, destination, mode, **kwargs):
        if mode == "TRANSIT":
            return {"mode": mode, "evidence": {"provider": "SYNTHETIC", "status": "UNKNOWN"}}
        return await original(origin, destination, mode, **kwargs)
    maps.routes = no_transit
    result = generate(client)
    assert all(s["mode"] == "WALK" for s in result["data"]["result"]["plan"]["segments"])


def test_natural_language_mixed_place_add_and_remove_is_one_preview(env):
    client, _, gateway, _ = env
    plan = generate(client)["data"]["result"]["plan"]
    gateway.reply = {"kind": "REVISION", "operations": [
        {"type": "REMOVE", "activityId": plan["activities"][0]["id"]},
        {"type": "ADD_PLACE", "placeQuery": "合成景点5", "dayIndex": 0, "orderIndex": 0, "durationMin": 45}], "questions": []}
    result = wait(client, post(client, "/revisions/propose", context(plan, userRequest="删掉第一站，新增合成景点5作为第一站")))
    assert result["status"] in ("SUCCEEDED", "PARTIAL"), result
    proposal = result["data"]["result"]["proposal"]
    assert proposal["diff"]["added"] and proposal["diff"]["removed"]
    assert [o["type"] for o in proposal["operations"]] == ["REMOVE", "ADD"]
    assert proposal["candidate"]["activities"][0]["place"]["poiId"] == "p5"
