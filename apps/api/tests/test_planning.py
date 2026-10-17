"""Synthetic fixtures only: no real provider, opening-hour or tariff claims."""
import copy
from datetime import date, timedelta

import pytest

from app.planning import PlanningError, apply_operations, build_plan, build_proposal, reschedule
from app.schemas import TripRequirements, TripState
from app.validation import as_dict, validate_plan


def poi(identifier="p1", name="合成博物馆", price=10):
    evidence = {"provider": "SYNTHETIC_TEST", "externalId": identifier, "status": "VERIFIED", "fetchedAt": "2026-10-16T00:00:00Z", "note": "人工合成，非真实API或营业事实"}
    return {"poiId": identifier, "name": name, "location": {"lat": 39.9, "lng": 116.4, "coordinateSystem": "GCJ02"}, "evidence": [evidence], "openingHours": {"value": "08:00-22:00", "evidence": evidence}, "ticketPriceCny": {"value": price, "evidence": evidence}}


def requirements(days=1, **changes):
    result = {"requirementsId": "synthetic-requirements", "version": 1, "confirmed": True, "destinationCity": "合成测试城市", "startDate": "2026-10-20", "endDate": (date(2026, 10, 20) + timedelta(days=days - 1)).isoformat(), "timezone": "Asia/Shanghai", "travelerCount": 2, "budgetCny": 1000, "budgetScope": "TOTAL", "budgetIsHardLimit": True, "transportModes": ["TRANSIT", "WALK"], "mustVisit": [], "avoidPlaces": [], "preferences": [], "companions": [], "specialNeeds": [], "dailyStartTime": "09:00", "dailyEndTime": "21:00", "fixedConstraints": [], "intents": []}
    result.update(changes)
    return TripRequirements.model_validate(result)


def plan(count=3, days=1, **changes):
    return build_plan("synthetic-trip", requirements(days, **changes), [poi(f"p{i}") for i in range(count)])


def routes(p, minutes=20):
    raw = as_dict(p)
    raw["segments"] = [{"fromActivityId": a["id"], "toActivityId": b["id"], "mode": "TRANSIT", "durationMin": minutes, "distanceMeters": 1500, "routeGeometry": [a["place"]["location"], b["place"]["location"]], "evidence": poi()["evidence"][0]} for a, b in zip(raw["activities"], raw["activities"][1:]) if a["dayIndex"] == b["dayIndex"]]
    return TripState.model_validate(raw)


@pytest.mark.parametrize("days", [1, 2, 3])
def test_build_covers_days_stable_ids_no_fabricated_routes(days):
    p = plan(days * 3, days)
    assert {a.dayIndex for a in p.activities} == set(range(days))
    assert [a.id for a in p.activities] == [a.id for a in plan(days * 3, days).activities]
    assert not p.segments
    assert not validate_plan(p).committable


def test_group_cost_and_preferences_change_selection():
    p = build_plan("trip", requirements(preferences=["公园"]), [poi("a", "合成博物馆"), poi("z", "合成公园")])
    assert p.activities[0].place.poiId == "z"
    assert p.activities[0].estimatedCostCny == 20


def test_companion_low_walking_and_fairness_affect_schedule():
    companions = [{"id": "child", "label": "同行甲", "interests": ["公园"], "specialNeeds": [], "walkingTolerance": "LOW"}, {"id": "adult", "label": "同行乙", "interests": ["博物馆"], "specialNeeds": []}]
    p = build_plan("trip", requirements(companions=companions), [poi("a", "合成公园"), poi("b", "合成公园二"), poi("z", "合成博物馆"), poi("x", "其他")])
    assert len(p.activities) == 2
    assert {a.place.poiId for a in p.activities} == {"a", "z"}
    assert p.activities[0].endAt == "2026-10-20T11:00:00+08:00"


def test_reschedule_uses_actual_duration_and_preserves_snapshot():
    p = routes(plan(), 45)
    before = p.model_dump_json()
    candidate = reschedule(p)
    assert candidate.activities[1].startAt == "2026-10-20T11:15:00+08:00"
    assert candidate.activities[2].startAt == "2026-10-20T13:30:00+08:00"
    assert validate_plan(candidate).committable
    assert p.model_dump_json() == before


def test_move_final_index_and_affected_routes_removed():
    p = routes(plan())
    ids = [a.id for a in p.activities]
    candidate = apply_operations(p, [{"type": "MOVE", "activityId": ids[0], "dayIndex": 0, "orderIndex": 2}])
    assert [a.id for a in candidate.activities] == ids[1:] + ids[:1]
    assert [a.orderIndex for a in candidate.activities] == [0, 1, 2]
    assert [(s.fromActivityId, s.toActivityId) for s in candidate.segments] == [(ids[1], ids[2])]
    assert candidate.revision == p.revision


def test_cross_day_move_keeps_id_and_clears_cross_day_routes():
    p = routes(plan(4, days=2))
    aid = p.activities[0].id
    candidate = apply_operations(p, [{"type": "MOVE", "activityId": aid, "dayIndex": 1, "orderIndex": 1}])
    moved = next(a for a in candidate.activities if a.id == aid)
    assert moved.startAt.startswith("2026-10-21")
    assert moved.dayIndex == 1 and moved.orderIndex == 1
    by_id = {a.id: a for a in candidate.activities}
    assert all(by_id[s.fromActivityId].dayIndex == by_id[s.toActivityId].dayIndex for s in candidate.segments)


def test_batch_add_replace_duration_time_constraint_diff():
    p = plan(2)
    aid = p.activities[0].id
    addition = as_dict(p.activities[1])
    addition.update(id="new-stable-id", orderIndex=2)
    operations = [{"type": "ADD", "activity": addition}, {"type": "REPLACE", "activityId": aid, "candidatePlaceId": "replacement", "candidatePlace": poi("replacement", price=30)}, {"type": "UPDATE_TIME", "activityId": aid, "startAt": "2026-10-20T10:00:00+08:00"}, {"type": "UPDATE_DURATION", "activityId": aid, "durationMin": 30}, {"type": "UPDATE_CONSTRAINT", "key": "budgetCny", "value": 900}]
    candidate = apply_operations(p, operations)
    assert candidate.activities[0].startAt == "2026-10-20T10:00:00+08:00"
    assert candidate.activities[0].endAt == "2026-10-20T10:30:00+08:00"
    proposal = build_proposal(p, candidate, operations)
    assert proposal.diff.added == ["new-stable-id"]
    assert proposal.candidate.revision == p.revision
    assert proposal.estimatedChanges.costCnyDelta == 60
    assert "place" in next(c.fields for c in proposal.activityChanges if c.activityId == aid)
    assert p.budgetCny == 1000


def test_atomic_failure_never_mutates_source_and_explicit_unlock_is_sequential():
    raw = as_dict(plan())
    raw["activities"][0]["locked"] = True
    p = TripState.model_validate(raw)
    aid = p.activities[0].id
    before = p.model_dump_json()
    with pytest.raises(PlanningError, match="解锁") as error:
        apply_operations(p, [{"type": "REMOVE", "activityId": p.activities[1].id}, {"type": "REMOVE", "activityId": aid}])
    assert error.value.code == "LOCKED_ACTIVITY_CHANGED"
    assert p.model_dump_json() == before
    operations = [{"type": "UPDATE_CONSTRAINT", "key": "activityLocked", "value": {"activityId": aid, "locked": False}}, {"type": "UPDATE_DURATION", "activityId": aid, "durationMin": 30}]
    candidate = apply_operations(p, operations)
    assert not candidate.activities[0].locked
    assert not any(v.code == "LOCKED_ACTIVITY_CHANGED" for v in validate_plan(candidate, p, operations).hardViolations)


def test_locked_intent_prevents_removal_and_unlocked_removed_task_is_cancelled():
    p = plan(1)
    aid = p.activities[0].id
    raw = as_dict(p)
    intent = {"id": "shoot", "activityId": aid, "placeId": p.activities[0].place.poiId, "type": "VIDEO_SHOOT", "userRequest": "合成拍摄任务", "desiredOutputs": ["讲稿"], "confirmed": True, "status": "PENDING", "preparedContentIds": [], "locked": True}
    raw["intents"] = raw["requirements"]["intents"] = [intent]
    raw["activities"][0]["intentIds"] = ["shoot"]
    p = TripState.model_validate(raw)
    with pytest.raises(PlanningError) as error:
        apply_operations(p, [{"type": "REMOVE", "activityId": aid}])
    assert error.value.code == "LOCKED_INTENT_CHANGED"
    intent = copy.deepcopy(intent)
    intent["locked"] = False
    ops = [{"type": "UPDATE_CONSTRAINT", "key": "intents", "value": [intent]}, {"type": "REMOVE", "activityId": aid}]
    candidate = apply_operations(p, ops)
    assert candidate.intents[0].status == "CANCELLED"
    assert candidate.intents[0].activityId is None


def test_fixed_appointment_and_arrival_are_preserved():
    place = poi()
    fixed = {"id": "appointment", "place": {"query": place["name"], "place": place}, "startAt": "2026-10-20T14:00:00+08:00", "endAt": "2026-10-20T15:00:00+08:00", "reason": "合成预约", "locked": True}
    p = build_plan("trip", requirements(fixedConstraints=[fixed], arrivalAt="2026-10-20T10:00:00+08:00"), [place])
    assert p.activities[0].startAt == fixed["startAt"]
    assert reschedule(p).activities[0].startAt == fixed["startAt"]


def test_constraint_whitelist_even_for_direct_python_call():
    with pytest.raises(PlanningError) as error:
        apply_operations(plan(), [{"type": "UPDATE_CONSTRAINT", "key": "confirmed", "value": False}])
    assert error.value.code == "CONSTRAINT_NOT_ALLOWED"


def test_date_change_shifts_times_explicitly_and_invalidates_routes():
    p = routes(plan())
    ops = [{"type": "UPDATE_CONSTRAINT", "key": "startDate", "value": "2026-10-21"}, {"type": "UPDATE_CONSTRAINT", "key": "endDate", "value": "2026-10-21"}]
    candidate = apply_operations(p, ops)
    assert all(a.startAt.startswith("2026-10-21") for a in candidate.activities)
    assert not candidate.segments


def test_unknown_cost_does_not_produce_fake_cost_delta():
    p = plan(1)
    unknown = poi("unknown")
    unknown.pop("ticketPriceCny")
    ops = [{"type": "REPLACE", "activityId": p.activities[0].id, "candidatePlaceId": "unknown", "candidatePlace": unknown}]
    proposal = build_proposal(p, apply_operations(p, ops), ops)
    assert proposal.estimatedChanges.costCnyDelta is None
    assert proposal.candidate.activities[0].estimatedCostCny is None


def test_verified_opening_window_adjusts_provisional_slot():
    place = poi()
    place["openingHours"]["value"] = "14:00-18:00"
    p = build_plan("trip", requirements(), [place])
    assert p.activities[0].startAt == "2026-10-20T14:00:00+08:00"
    assert validate_plan(p).committable


def test_explicit_time_anchor_is_not_hidden_by_reschedule():
    p = routes(plan(2), 30)
    aid = p.activities[1].id
    operations = [{"type": "UPDATE_TIME", "activityId": aid, "startAt": "2026-10-20T09:30:00+08:00"}]
    candidate = apply_operations(p, operations)
    candidate = reschedule(candidate, preserve_activity_ids=[aid])
    assert candidate.activities[1].startAt == "2026-10-20T09:30:00+08:00"
    assert not build_proposal(p, candidate, operations).validation.committable


def test_root_model_constraint_union_can_be_applied_and_proposed():
    from pydantic import TypeAdapter
    from app.schemas import EditOperation
    operation = TypeAdapter(EditOperation).validate_python({"type": "UPDATE_CONSTRAINT", "key": "budgetCny", "value": 1200})
    p = plan(1)
    candidate = apply_operations(p, [operation])
    proposal = build_proposal(p, candidate, [operation])
    assert proposal.candidate.budgetCny == 1200
    assert not proposal.hardViolations


def test_rejected_batch_is_reviewable_infeasible_proposal_not_failed_job():
    raw = as_dict(plan(1))
    raw["activities"][0]["locked"] = True
    p = TripState.model_validate(raw)
    operations = [{"type": "REMOVE", "activityId": p.activities[0].id}]
    with pytest.raises(PlanningError) as caught:
        apply_operations(p, operations)
    proposal = build_proposal(p, p, operations, rejection=caught.value)
    assert proposal.validation.status == "INFEASIBLE"
    assert not proposal.validation.committable
    assert proposal.hardViolations[0].code == "LOCKED_ACTIVITY_CHANGED"
    assert proposal.candidate == p


def test_confirmed_intent_poi_is_selected_before_optional_preferences():
    intent = {"id": "task", "placeId": "zz-task", "type": "VIDEO_SHOOT", "userRequest": "必须完成合成任务", "desiredOutputs": [], "confirmed": True, "status": "PENDING", "preparedContentIds": [], "locked": True}
    p = build_plan("trip", requirements(intents=[intent], preferences=["公园"]), [poi(f"p{i}", "合成公园") for i in range(8)] + [poi("zz-task", "任务地点")])
    assert "zz-task" in {a.place.poiId for a in p.activities}
    assert p.intents[0].activityId in {a.id for a in p.activities}


def test_repeat_fixed_visits_get_distinct_stable_ids_and_no_cross_day_route():
    place = poi()
    fixed = [{"id": f"appointment-{i}", "place": {"query": place["name"], "place": place}, "startAt": f"2026-10-{20+i}T14:00:00+08:00", "endAt": f"2026-10-{20+i}T15:00:00+08:00", "reason": "合成每日集合", "locked": True} for i in range(2)]
    p = build_plan("trip", requirements(2, fixedConstraints=fixed), [place])
    assert len(p.activities) == 2
    assert len({a.id for a in p.activities}) == 2
    assert {a.dayIndex for a in p.activities} == {0, 1}
    assert validate_plan(p).committable


def test_shorten_unlocked_dates_reassigns_day_and_preserves_ids():
    p = plan(4, days=2)
    ops = [{"type": "UPDATE_CONSTRAINT", "key": "endDate", "value": "2026-10-20"}]
    candidate = reschedule(apply_operations(p, ops))
    assert {a.id for a in candidate.activities} == {a.id for a in p.activities}
    assert all(a.dayIndex == 0 and a.startAt.startswith("2026-10-20") for a in candidate.activities)
    assert [a.orderIndex for a in candidate.activities] == list(range(4))


def test_date_change_with_new_activity_does_not_shift_addition_twice():
    p = plan(1)
    addition = as_dict(p.activities[0])
    addition.update(id="added-on-new-date", orderIndex=1, startAt="2026-10-21T12:00:00+08:00", endAt="2026-10-21T13:00:00+08:00")
    ops = [{"type": "UPDATE_CONSTRAINT", "key": "startDate", "value": "2026-10-21"}, {"type": "UPDATE_CONSTRAINT", "key": "endDate", "value": "2026-10-21"}, {"type": "ADD", "activity": addition}]
    candidate = apply_operations(p, ops)
    assert all(a.startAt.startswith("2026-10-21") for a in candidate.activities)


def test_explicit_fixed_constraint_time_change_updates_unlocked_slot():
    p = plan(1)
    fixed = {"id": "fixed", "activityId": p.activities[0].id, "startAt": "2026-10-20T14:00:00+08:00", "endAt": "2026-10-20T15:00:00+08:00", "reason": "合成集合", "locked": False}
    ops = [{"type": "UPDATE_CONSTRAINT", "key": "fixedConstraints", "value": [fixed]}]
    candidate = apply_operations(p, ops)
    assert candidate.activities[0].startAt == fixed["startAt"]
    assert validate_plan(candidate, p, ops).committable
