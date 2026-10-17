"""A5 checks use explicitly synthetic facts, not live supplier evidence."""
import copy

import pytest

from app.planning import build_plan, reschedule
from app.schemas import TripRequirements, TripState
from app.validation import as_dict, validate_plan


def sample(count=1, **requirements):
    evidence = {"provider": "SYNTHETIC_TEST_ONLY", "status": "VERIFIED", "fetchedAt": "2026-10-16T00:00:00Z", "note": "人工合成，不能作为真实API验收"}
    req = {"requirementsId": "r", "version": 0, "confirmed": True, "destinationCity": "测试城市", "startDate": "2026-10-20", "endDate": "2026-10-20", "timezone": "Asia/Shanghai", "travelerCount": 3, "budgetCny": 100, "budgetScope": "PER_PERSON", "budgetIsHardLimit": True, "transportModes": ["TRANSIT"], "mustVisit": [], "avoidPlaces": [], "preferences": [], "companions": [], "specialNeeds": [], "dailyStartTime": "09:00", "dailyEndTime": "21:00", "fixedConstraints": [], "intents": []}
    req.update(requirements)
    places = [{"poiId": f"poi-{i}", "name": f"合成地点{i}", "location": {"lat": 39.9 + i / 1000, "lng": 116.4, "coordinateSystem": "GCJ02"}, "evidence": [evidence], "openingHours": {"value": "08:00-22:00", "evidence": evidence}, "ticketPriceCny": {"value": 20, "evidence": evidence}} for i in range(count)]
    return build_plan("trip", TripRequirements.model_validate(req), places)


def with_route(p, minutes=30):
    raw = as_dict(p)
    raw["segments"] = [{"fromActivityId": a["id"], "toActivityId": b["id"], "mode": "TRANSIT", "durationMin": minutes, "distanceMeters": 2000, "routeGeometry": [a["place"]["location"], b["place"]["location"]], "evidence": a["place"]["evidence"][0]} for a, b in zip(raw["activities"], raw["activities"][1:]) if a["dayIndex"] == b["dayIndex"]]
    return TripState.model_validate(raw)


def codes(report):
    return {v.code for v in report.hardViolations}


def test_verified_single_activity_is_feasible_and_validator_is_pure():
    p = sample()
    original = p.model_dump_json()
    result = validate_plan(p)
    assert result.status == "FEASIBLE" and result.committable
    assert p.model_dump_json() == original


def test_unknown_price_and_opening_are_partial_not_zero_or_24_hours():
    raw = as_dict(sample())
    raw["activities"][0].pop("estimatedCostCny")
    raw["activities"][0]["costStatus"] = "UNKNOWN"
    raw["activities"][0]["place"].pop("openingHours")
    result = validate_plan(TripState.model_validate(raw))
    assert result.status == "PARTIALLY_VERIFIED" and result.committable
    assert any("OPENING_HOURS_UNKNOWN" in u for u in result.unknownChecks)
    assert any("COST_UNKNOWN" in u for u in result.unknownChecks)


@pytest.mark.parametrize("opening, expected", [("09:00-10:00", "OPENING_HOURS_VIOLATION"), ("09:00-10:00,14:00-18:00", "OPENING_HOURS_VIOLATION")])
def test_verified_opening_hours_are_hard_constraints(opening, expected):
    raw = as_dict(sample())
    raw["activities"][0]["place"]["openingHours"]["value"] = opening
    report = validate_plan(TripState.model_validate(raw))
    assert expected in codes(report) and not report.committable


def test_complex_weekly_opening_not_silently_treated_as_daily():
    raw = as_dict(sample())
    raw["activities"][0]["place"]["openingHours"]["value"] = "周一闭馆，09:00-18:00"
    report = validate_plan(TripState.model_validate(raw))
    assert "OPENING_HOURS_VIOLATION" not in codes(report)
    assert any("OPENING_HOURS_UNKNOWN" in item for item in report.unknownChecks)


def test_unverified_place_blocks_despite_acceptable_unknown_prices():
    raw = as_dict(sample())
    raw["activities"][0]["place"]["evidence"] = []
    report = validate_plan(TripState.model_validate(raw))
    assert report.status == "PARTIALLY_VERIFIED" and not report.committable
    assert any("PLACE_UNVERIFIED" in item for item in report.unknownChecks)


def test_missing_route_unknown_blocks_but_verified_impossible_route_is_conflict():
    p = sample(2)
    unknown = validate_plan(p)
    assert not unknown.hardViolations and not unknown.committable
    assert any("TRANSIT_UNKNOWN" in item for item in unknown.unknownChecks)
    impossible = validate_plan(with_route(p, 300))
    assert "TRANSIT_INFEASIBLE" in codes(impossible)
    scheduled = reschedule(with_route(p, 30))
    assert validate_plan(scheduled).committable


def test_final_validation_of_changed_route_does_not_silently_reschedule():
    preview = reschedule(with_route(sample(2), 20))
    raw = as_dict(preview)
    raw["segments"][0]["durationMin"] = 100
    refreshed = TripState.model_validate(raw)
    before = refreshed.model_dump_json()
    assert "TRANSIT_INFEASIBLE" in codes(validate_plan(refreshed))
    assert refreshed.model_dump_json() == before


def test_budget_per_person_is_compared_with_group_cost_and_inclusions_unknown():
    assert validate_plan(sample(budgetCny=25)).committable  # 60 <= 25*3
    report = validate_plan(sample(budgetCny=15))
    assert "BUDGET_EXCEEDED" in codes(report)
    report = validate_plan(sample(includesAccommodation=True, includesIntercityTransport=True))
    assert report.status == "PARTIALLY_VERIFIED"
    assert any("ACCOMMODATION_COST_UNKNOWN" in item for item in report.unknownChecks)
    assert any("INTERCITY_COST_UNKNOWN" in item for item in report.unknownChecks)


def test_estimated_cost_does_not_create_false_verified_budget_violation():
    raw = as_dict(sample(budgetCny=10))
    raw["activities"][0]["costStatus"] = "ESTIMATED"
    raw["activities"][0]["place"]["ticketPriceCny"]["evidence"]["status"] = "ESTIMATED"
    report = validate_plan(TripState.model_validate(raw))
    assert "BUDGET_EXCEEDED" not in codes(report)
    assert report.warnings and report.status == "PARTIALLY_VERIFIED"


def test_mandatory_and_unresolved_reference_are_not_silently_rebound():
    reference = {"query": "合成地点0"}  # same name is still not an identity
    report = validate_plan(sample(mustVisit=[reference]))
    assert not report.committable
    assert any("MUST_VISIT_UNRESOLVED" in item for item in report.unknownChecks)
    raw = as_dict(sample())
    missing = copy.deepcopy(raw["activities"][0]["place"])
    missing["poiId"] = "missing-id"
    raw["requirements"]["mustVisit"] = [{"query": "必去点", "place": missing}]
    assert "MUST_VISIT_MISSING" in codes(validate_plan(TripState.model_validate(raw)))


def test_lock_fixed_and_booked_are_independently_checked():
    p = sample()
    raw = as_dict(p)
    raw["activities"][0]["locked"] = True
    original = TripState.model_validate(raw)
    changed = copy.deepcopy(raw)
    changed["activities"][0]["startAt"] = "2026-10-20T10:00:00+08:00"
    changed["activities"][0]["endAt"] = "2026-10-20T11:30:00+08:00"
    assert "LOCKED_ACTIVITY_CHANGED" in codes(validate_plan(TripState.model_validate(changed), original))
    raw["activities"][0]["locked"] = False
    raw["activities"][0]["bookingStatus"] = "BOOKED"
    original = TripState.model_validate(raw)
    changed["activities"][0]["locked"] = False
    assert "BOOKED_ACTIVITY_CHANGED" in codes(validate_plan(TripState.model_validate(changed), original))
    fixed = {"id": "fixed", "activityId": p.activities[0].id, "startAt": "2026-10-20T11:00:00+08:00", "endAt": "2026-10-20T12:00:00+08:00", "reason": "合成固定集合", "locked": True}
    changed["requirements"]["fixedConstraints"] = [fixed]
    assert "FIXED_CONSTRAINT_VIOLATION" in codes(validate_plan(TripState.model_validate(changed)))


def test_window_and_departure_and_avoid_are_hard():
    assert "TIME_WINDOW_VIOLATION" in codes(validate_plan(sample(departureAt="2026-10-20T09:30:00+08:00")))
    raw = as_dict(sample())
    raw["requirements"]["avoidPlaces"] = [{"query": "避开点", "place": raw["activities"][0]["place"]}]
    assert "AVOID_PLACE_INCLUDED" in codes(validate_plan(TripState.model_validate(raw)))


def test_boundary_route_arrival_duration_and_departure_are_checked():
    p = sample()
    raw = as_dict(p)
    station = copy.deepcopy(raw["activities"][0]["place"])
    station["poiId"] = "station"
    raw["requirements"]["startPoint"] = {"query": "合成起点", "place": station}
    raw["requirements"]["arrivalAt"] = "2026-10-20T08:45:00+08:00"
    assert not validate_plan(TripState.model_validate(raw)).committable
    a = raw["activities"][0]
    raw["boundarySegments"] = [{"dayIndex": 0, "from": {"kind": "START_POINT", "place": station}, "to": {"kind": "ACTIVITY", "activityId": a["id"], "place": a["place"]}, "mode": "TRANSIT", "durationMin": 45, "distanceMeters": 4000, "routeGeometry": [station["location"], a["place"]["location"]], "evidence": a["place"]["evidence"][0]}]
    boundary_plan = TripState.model_validate(raw)
    assert "TRANSIT_INFEASIBLE" in codes(validate_plan(boundary_plan))
    scheduled = reschedule(boundary_plan)
    assert scheduled.activities[0].startAt == "2026-10-20T09:30:00+08:00"
    assert validate_plan(scheduled).committable


def test_implicit_budget_relaxation_and_revision_change_are_rejected():
    old = sample()
    raw = as_dict(old)
    raw["budgetCny"] = raw["requirements"]["budgetCny"] = 10000
    raw["revision"] += 1
    report = validate_plan(TripState.model_validate(raw), old)
    assert {"STALE_REVISION", "IMPLICIT_CONSTRAINT_CHANGE"} <= codes(report)


def test_schema_rejects_cross_day_links_before_a5():
    p = sample(2, endDate="2026-10-21")
    raw = as_dict(p)
    raw["segments"] = [{"fromActivityId": raw["activities"][0]["id"], "toActivityId": raw["activities"][1]["id"], "mode": "TRANSIT", "durationMin": 30, "evidence": raw["activities"][0]["place"]["evidence"][0]}]
    with pytest.raises(ValueError, match="cross travel days"):
        TripState.model_validate(raw)


def test_unresolved_confirmed_location_intent_is_blocking():
    intent = {"id": "task", "placeQuery": "同名景点", "type": "VIDEO_SHOOT", "userRequest": "必须到指定地点拍摄", "desiredOutputs": [], "confirmed": True, "status": "PENDING", "preparedContentIds": [], "locked": True}
    report = validate_plan(sample(intents=[intent]))
    assert not report.committable
    assert any("INTENT_PLACE_UNRESOLVED" in item for item in report.unknownChecks)


def test_missing_budget_scope_does_not_create_false_budget_conflict():
    report = validate_plan(sample(budgetCny=25, budgetScope=None))
    assert "BUDGET_EXCEEDED" not in codes(report)
    assert not report.committable
    assert any("BUDGET_SCOPE_UNKNOWN" in item for item in report.unknownChecks)


def test_special_needs_are_unverified_instead_of_fabricated_facilities():
    companion = {"id": "person", "label": "同行人甲", "interests": [], "specialNeeds": ["无障碍通道"], "personalBudgetCny": 10}
    report = validate_plan(sample(companions=[companion]))
    assert any("SPECIAL_NEEDS_UNKNOWN" in item for item in report.unknownChecks)
    assert report.warnings


def test_client_cannot_mark_unsupported_cost_as_verified():
    raw = as_dict(sample())
    raw["activities"][0]["place"].pop("ticketPriceCny")
    raw["activities"][0]["estimatedCostCny"] = 0
    report = validate_plan(TripState.model_validate(raw))
    assert report.status == "PARTIALLY_VERIFIED"
    assert any("COST_UNKNOWN" in item for item in report.unknownChecks)


def test_verified_ticket_lower_bound_still_blocks_when_activity_cost_unknown():
    raw = as_dict(sample(budgetCny=10))
    raw["activities"][0]["costStatus"] = "UNKNOWN"
    raw["activities"][0].pop("estimatedCostCny")
    report = validate_plan(TripState.model_validate(raw))
    assert "BUDGET_EXCEEDED" in codes(report)


def test_locked_poi_evidence_refresh_is_not_a_place_change():
    raw = as_dict(sample())
    raw["activities"][0]["locked"] = True
    old = TripState.model_validate(raw)
    raw["activities"][0]["place"]["evidence"][0]["fetchedAt"] = "2026-10-16T02:00:00Z"
    new = TripState.model_validate(raw)
    assert "LOCKED_ACTIVITY_CHANGED" not in codes(validate_plan(new, old))
