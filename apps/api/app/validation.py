"""A5: independent, deterministic checks. Validation never repairs its input.

Unknown facts are explicitly separated from demonstrated conflicts. Missing POI
identity or travel time blocks confirmation; unknown admission/opening facts can
be accepted by the user, but never count as verified feasibility.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from .schemas import ValidationReport


def as_dict(value: Any) -> dict:
    return value.model_dump(mode="json", by_alias=True, exclude_none=True) if hasattr(value, "model_dump") else value


def moment(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))


def ordered_activities(plan: Any) -> list[dict]:
    return sorted(as_dict(plan)["activities"], key=lambda a: (a["dayIndex"], a["orderIndex"]))


def verified(evidence: dict | None) -> bool:
    return bool(evidence and evidence.get("status") == "VERIFIED" and evidence.get("provider"))


def place_verified(place: dict) -> bool:
    return any(verified(e) for e in place.get("evidence", []))


def _trusted_cost(activity: dict, traveler_count: int) -> float | None:
    price = activity["place"].get("ticketPriceCny") or {}
    # In v1 the only evidenced numeric cost field is the per-person ticket.
    # A client's self-declared costStatus is not independent price evidence.
    if verified(price.get("evidence")) and price.get("value") is not None:
        return price["value"] * traveler_count
    return None


def _activity_changed(before: dict, after: dict, keys: tuple[str, ...]) -> bool:
    for key in keys:
        if key == "place":
            if any(before["place"].get(k) != after["place"].get(k) for k in ("poiId", "location")):
                return True
        elif before.get(key) != after.get(key):
            return True
    return False


def _matches(reference: dict, activity: dict) -> bool:
    # A query is not a resolved identity. Never silently use fuzzy name matching.
    return bool(reference.get("place") and reference["place"]["poiId"] == activity["place"]["poiId"])


def _opening_windows(text: str) -> list[tuple[int, int]] | None:
    value = text.strip()
    if value.lower() in {"24h", "24 hours", "00:00-24:00", "00:00–24:00", "全天", "全天开放", "24小时", "24小时开放"}:
        return [(0, 1440)]
    # Complex holiday/week-day/seasonal policies need a provider-specific parser.
    if re.search(r"[周星期年月日闭休]|holiday|monday|tuesday|season", value, re.I):
        return None
    matches = list(re.finditer(r"(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})", value))
    if not matches:
        return None
    remainder = re.sub(r"(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})", "", value)
    if remainder.strip(" ,，;；/、开放时间营业时间:："):
        return None
    windows = []
    for match in matches:
        h1, m1, h2, m2 = map(int, match.groups())
        if h1 > 23 or h2 > 24 or m1 > 59 or m2 > 59 or (h2 == 24 and m2):
            return None
        start, end = h1 * 60 + m1, h2 * 60 + m2
        if end <= start:  # Overnight opening needs an explicit date-aware policy.
            return None
        windows.append((start, end))
    return windows


def expected_edges(plan: Any) -> set[tuple[str, str]]:
    activities = ordered_activities(plan)
    return {(a["id"], b["id"]) for a, b in zip(activities, activities[1:]) if a["dayIndex"] == b["dayIndex"]}


def validate_plan(plan: Any, original: Any = None, operations: list[Any] | None = None) -> ValidationReport:
    p = as_dict(plan)
    req = p["requirements"]
    activities = ordered_activities(p)
    by_id = {a["id"]: a for a in activities}
    hard: list[dict] = []
    unknown: list[str] = []
    warnings: list[str] = []
    blocking_unknown = False

    def fail(code: str, message: str, ids: list[str] | None = None) -> None:
        item = {"code": code, "activityIds": ids or [], "message": message}
        if item not in hard:
            hard.append(item)

    def unsure(message: str, blocking: bool = False) -> None:
        nonlocal blocking_unknown
        if message not in unknown:
            unknown.append(message)
        blocking_unknown |= blocking

    start_date, end_date = date.fromisoformat(p["startDate"]), date.fromisoformat(p["endDate"])
    days = (end_date - start_date).days + 1
    if not 1 <= days <= 3:
        fail("DATE_RANGE_INVALID", "行程必须覆盖连续的1至3天。")
    for key in ("destinationCity", "startDate", "endDate", "travelerCount", "budgetCny", "budgetScope", "companions", "preferences", "intents"):
        if p.get(key) != req.get(key):
            fail("REQUIREMENTS_PROJECTION_MISMATCH", f"{key}与已确认需求不一致。")
    if not req.get("confirmed"):
        fail("REQUIREMENTS_UNCONFIRMED", "需求尚未得到用户确认。")
    if len(by_id) != len(activities):
        fail("DUPLICATE_ACTIVITY_ID", "活动ID必须唯一且稳定。")
    if not activities:
        fail("EMPTY_PLAN", "没有可供确认的活动。")

    for day in range(max(days, 0)):
        day_activities = [a for a in activities if a["dayIndex"] == day]
        if [a["orderIndex"] for a in day_activities] != list(range(len(day_activities))):
            fail("ORDER_INDEX_INVALID", "每天的活动索引必须从0连续递增。", [a["id"] for a in day_activities])
        if not day_activities:
            warnings.append(f"第{day + 1}天没有游览活动。")

    for a in activities:
        aid = [a["id"]]
        start, end = moment(a["startAt"]), moment(a["endAt"])
        expected_date = start_date + timedelta(days=a["dayIndex"])
        if not 0 <= a["dayIndex"] < days or start.date() != expected_date or end.date() != expected_date:
            fail("TIME_WINDOW_VIOLATION", "活动日期必须与dayIndex及行程日期一致，不能跨日。", aid)
        if end <= start:
            fail("INVALID_DURATION", "活动结束必须晚于开始。", aid)
        lower = moment(f"{expected_date}T{req.get('dailyStartTime') or '00:00'}:00+08:00")
        upper_clock = req.get("dailyEndTime") or "23:59"
        upper = moment(f"{expected_date}T{upper_clock}:00+08:00")
        if start < lower or end > upper or (req.get("arrivalAt") and start < moment(req["arrivalAt"])) or (req.get("departureAt") and end > moment(req["departureAt"])):
            fail("TIME_WINDOW_VIOLATION", "活动超出每日窗口、到达或离开时间。", aid)
        place = a["place"]
        if not place_verified(place):
            unsure(f"PLACE_UNVERIFIED:{a['id']}:{place['name']}的POI来源尚未核实。", True)
        opening = place.get("openingHours") or {}
        windows = _opening_windows(opening.get("value", "")) if verified(opening.get("evidence")) else None
        if windows is None:
            unsure(f"OPENING_HOURS_UNKNOWN:{a['id']}:开放时段未核实或尚不能可靠解析。")
        else:
            begin = start.hour * 60 + start.minute + start.second / 60
            finish = end.hour * 60 + end.minute + end.second / 60
            if not any(begin >= lo and finish <= hi for lo, hi in windows):
                fail("OPENING_HOURS_VIOLATION", "活动不在已核实开放时段内。", aid)
        price = place.get("ticketPriceCny") or {}
        if a.get("estimatedCostCny") is None or a.get("costStatus") != "VERIFIED" or _trusted_cost(a, p["travelerCount"]) is None:
            unsure(f"COST_UNKNOWN:{a['id']}:整团活动费用未完全核实。")
        if verified(price.get("evidence")) and price.get("value") is not None and a.get("costStatus") == "VERIFIED":
            if a.get("estimatedCostCny") != price["value"] * p["travelerCount"]:
                fail("COST_BASIS_MISMATCH", "活动费用必须按已核实每人票价转换为整团人民币，且不重复计费。", aid)
        if a.get("bookingStatus") == "REQUIRED":
            unsure(f"BOOKING_UNCONFIRMED:{a['id']}:要求预约的活动尚未确认预约。", True)
        if a.get("bookingStatus") == "BOOKED" and not verified(a.get("bookingEvidence")):
            unsure(f"BOOKING_EVIDENCE_UNKNOWN:{a['id']}:预约凭据尚未核实。")
        known_intents = {i["id"] for i in p.get("intents", [])}
        if any(i not in known_intents for i in a.get("intentIds", [])):
            fail("INTENT_REFERENCE_INVALID", "活动引用了不存在的意图。", aid)

    for reference in req.get("mustVisit", []):
        if not reference.get("place"):
            unsure(f"MUST_VISIT_UNRESOLVED:{reference['query']}:必去地点尚未明确匹配。", True)
        elif not any(_matches(reference, a) for a in activities):
            fail("MUST_VISIT_MISSING", f"必去地点{reference['query']}未被安排。")
    for reference in req.get("avoidPlaces", []):
        if reference.get("place"):
            matches = [a["id"] for a in activities if _matches(reference, a)]
            if matches:
                fail("AVOID_PLACE_INCLUDED", f"行程包含明确避开的地点{reference['query']}。", matches)
        else:
            unsure(f"AVOID_PLACE_UNRESOLVED:{reference['query']}:避开地点尚未明确匹配。")

    for constraint in req.get("fixedConstraints", []):
        target = [by_id[constraint["activityId"]]] if constraint.get("activityId") in by_id else []
        if not target and constraint.get("place"):
            target = [a for a in activities if _matches(constraint["place"], a)]
        if not target:
            if constraint.get("place") and not constraint["place"].get("place"):
                unsure(f"FIXED_PLACE_UNRESOLVED:{constraint['id']}:固定集合地点未核实。", True)
            else:
                fail("FIXED_CONSTRAINT_MISSING", f"固定条件{constraint['reason']}没有对应活动。")
        elif not any(moment(a["startAt"]) == moment(constraint["startAt"]) and (not constraint.get("endAt") or moment(a["endAt"]) == moment(constraint["endAt"])) for a in target):
            fail("FIXED_CONSTRAINT_VIOLATION", f"未满足固定时间：{constraint['reason']}。", [a["id"] for a in target])

    expected = expected_edges(p)
    seen = set()
    for segment in p.get("segments", []):
        edge = (segment["fromActivityId"], segment["toActivityId"])
        if edge in seen:
            fail("DUPLICATE_ROUTE", "同一相邻路段出现重复路线。", list(edge))
        seen.add(edge)
        if edge not in expected:
            fail("ROUTE_ADJACENCY_INVALID", "路线必须连接当日相邻活动，不能跨日连线。", list(edge))
            continue
        before, after = by_id[edge[0]], by_id[edge[1]]
        if segment.get("mode") not in req.get("transportModes", []):
            fail("TRANSPORT_MODE_VIOLATION", "路线使用了需求未允许的交通方式。", list(edge))
        duration = segment.get("durationMin")
        if duration is None or not verified(segment.get("evidence")):
            unsure(f"TRANSIT_UNKNOWN:{edge[0]}->{edge[1]}:缺少可支持时间可达性的路线。", True)
        elif moment(before["endAt"]) + timedelta(minutes=duration) > moment(after["startAt"]):
            fail("TRANSIT_INFEASIBLE", "已核实交通时长超过两个活动之间的空隙。", list(edge))
        if not segment.get("routeGeometry"):
            unsure(f"ROUTE_GEOMETRY_UNKNOWN:{edge[0]}->{edge[1]}:缺少真实路段几何。")
    for before, after in sorted(expected - seen):
        unsure(f"TRANSIT_UNKNOWN:{before}->{after}:相邻活动路线尚未获取。", True)
    for a, b in zip(activities, activities[1:]):
        if a["dayIndex"] == b["dayIndex"] and moment(a["endAt"]) > moment(b["startAt"]):
            fail("ACTIVITY_OVERLAP", "同一旅客的两个活动时间重叠。", [a["id"], b["id"]])

    boundary_expected = []
    if activities:
        if req.get("startPoint"):
            boundary_expected.append(("START_POINT", activities[0], "startPoint"))
        if req.get("endPoint"):
            boundary_expected.append(("END_POINT", activities[-1], "endPoint"))
    used_boundaries = set()
    for kind, activity, ref_key in boundary_expected:
        reference = req[ref_key]
        if not reference.get("place"):
            unsure(f"BOUNDARY_PLACE_UNRESOLVED:{kind}:{reference['query']}:起止点尚未明确匹配。", True)
            continue
        if (kind == "START_POINT" and activity["dayIndex"] != 0) or (kind == "END_POINT" and activity["dayIndex"] != days - 1):
            fail("BOUNDARY_ACTIVITY_MISSING", "首日或末日缺少衔接起止点的活动。", [activity["id"]])
        matched = []
        for index, segment in enumerate(p.get("boundarySegments", [])):
            origin, target = segment["from"], segment["to"]
            boundary, endpoint = (origin, target) if kind == "START_POINT" else (target, origin)
            if boundary.get("kind") == kind and endpoint.get("kind") == "ACTIVITY" and endpoint.get("activityId") == activity["id"]:
                if boundary.get("place", {}).get("poiId") == reference["place"]["poiId"] and endpoint.get("place", {}).get("poiId") == activity["place"]["poiId"] and segment["dayIndex"] == activity["dayIndex"]:
                    matched.append(segment)
                    used_boundaries.add(index)
        if len(matched) > 1:
            fail("DUPLICATE_ROUTE", "起止边界路线重复。", [activity["id"]])
        if not matched:
            unsure(f"BOUNDARY_TRANSIT_UNKNOWN:{kind}:起止交通路线未获取。", True)
            continue
        segment = matched[0]
        if segment.get("mode") not in req.get("transportModes", []):
            fail("TRANSPORT_MODE_VIOLATION", "起止路线使用了未允许的交通方式。", [activity["id"]])
        if segment.get("durationMin") is None or not verified(segment.get("evidence")):
            unsure(f"BOUNDARY_TRANSIT_UNKNOWN:{kind}:起止交通时长未核实。", True)
        else:
            delta = timedelta(minutes=segment["durationMin"])
            if kind == "START_POINT" and req.get("arrivalAt") and moment(req["arrivalAt"]) + delta > moment(activity["startAt"]):
                fail("TRANSIT_INFEASIBLE", "到达时间与起点至首站真实交通不相容。", [activity["id"]])
            if kind == "END_POINT" and req.get("departureAt") and moment(activity["endAt"]) + delta > moment(req["departureAt"]):
                fail("TRANSIT_INFEASIBLE", "末站至终点真实交通无法赶上离开时间。", [activity["id"]])
    if len(used_boundaries) != len(p.get("boundarySegments", [])):
        fail("BOUNDARY_ROUTE_INVALID", "边界路线必须对应需求起止点及当日首末站。")

    budget = req.get("budgetCny")
    trusted_activity_cost = sum(_trusted_cost(a, p["travelerCount"]) or 0 for a in activities)
    for companion in req.get("companions", []):
        if companion.get("personalBudgetCny") is not None and trusted_activity_cost / p["travelerCount"] > companion["personalBudgetCny"]:
            warnings.append(f"同行人{companion['label']}的个人预算偏好可能超出，请明确协商费用分配。")
    needs = req.get("specialNeeds", []) + [need for c in req.get("companions", []) for need in c.get("specialNeeds", [])]
    for need in dict.fromkeys(needs):
        unsure(f"SPECIAL_NEEDS_UNKNOWN:{need}:POI契约未提供足以核实该特殊需求的设施信息。")
    if budget is not None:
        if req.get("budgetScope") is None:
            unsure("BUDGET_SCOPE_UNKNOWN:预算尚未明确按人或整团口径。", True)
        limit = budget * (p["travelerCount"] if req.get("budgetScope") == "PER_PERSON" else 1) if req.get("budgetScope") else float("inf")
        trusted_cost = trusted_activity_cost
        estimated_cost = sum(a.get("estimatedCostCny") or 0 for a in activities)
        if trusted_cost > limit:
            if req.get("budgetIsHardLimit"):
                fail("BUDGET_EXCEEDED", f"已核实整团费用{trusted_cost:g}元超过整团预算{limit:g}元。")
            else:
                warnings.append("已核实费用超过预算偏好，请确认。")
        elif estimated_cost > limit:
            warnings.append("含估算项的费用可能超出预算，尚不能视作已核实冲突。")
        if req.get("includesAccommodation"):
            unsure("ACCOMMODATION_COST_UNKNOWN:预算包含住宿，但尚无可核验住宿费用字段。")
        if req.get("includesIntercityTransport"):
            unsure("INTERCITY_COST_UNKNOWN:预算包含城际交通，但尚无可核验城际费用字段。")
        if p.get("segments") or p.get("boundarySegments"):
            unsure("TRANSIT_COST_UNKNOWN:路线契约未提供票价，不能将交通费用记为0。")

    for intent in p.get("intents", []):
        if intent.get("status") != "CANCELLED" and intent.get("placeQuery") and not intent.get("placeId"):
            unsure(f"INTENT_PLACE_UNRESOLVED:{intent['id']}:任务地点尚未明确匹配，不能静默绑定相似POI。", bool(intent.get("locked") or intent.get("confirmed")))
        if intent.get("status") != "CANCELLED" and intent.get("placeId") and not any(a["place"]["poiId"] == intent["placeId"] for a in activities):
            if intent.get("confirmed") or intent.get("locked"):
                fail("INTENT_PLACE_MISSING", "已确认任务关联地点没有安排活动。")
            else:
                unsure(f"INTENT_PLACE_MISSING:{intent['id']}:未确认任务地点不在本次活动中。")
        activity_id = intent.get("activityId")
        if activity_id and activity_id not in by_id and intent.get("status") != "CANCELLED":
            fail("INTENT_ACTIVITY_MISSING", "有效意图关联的活动已不存在。", [activity_id])
        if activity_id in by_id and intent.get("placeId") and intent["placeId"] != by_id[activity_id]["place"]["poiId"]:
            fail("INTENT_PLACE_MISMATCH", "意图的地点与关联活动不一致。", [activity_id])

    if original is not None:
        old = as_dict(original)
        ops = [as_dict(o) for o in (operations or [])]
        unlocked = {o["value"]["activityId"] for o in ops if o.get("type") == "UPDATE_CONSTRAINT" and o.get("key") == "activityLocked" and o["value"]["locked"] is False}
        explicitly_changed = {o["key"] for o in ops if o.get("type") == "UPDATE_CONSTRAINT"}
        protected_fields = ("place", "dayIndex", "orderIndex", "startAt", "endAt", "intentIds")
        for before in old["activities"]:
            after = by_id.get(before["id"])
            if before.get("locked") and before["id"] not in unlocked:
                if after is None or not after.get("locked") or _activity_changed(before, after, protected_fields):
                    fail("LOCKED_ACTIVITY_CHANGED", "锁定活动未经明确解锁不能修改或删除。", [before["id"]])
            if before.get("mandatory") and after is None and "mustVisit" not in explicitly_changed:
                fail("MUST_VISIT_MISSING", "必去活动不能隐式删除。", [before["id"]])
            if before.get("bookingStatus") == "BOOKED" and (after is None or _activity_changed(before, after, ("place", "startAt", "endAt"))):
                fail("BOOKED_ACTIVITY_CHANGED", "已预订活动的地点和时段不能自动修改。", [before["id"]])
        current_intents = {i["id"]: i for i in p.get("intents", [])}
        for before in old.get("intents", []):
            unlock = any(o.get("key") == "intents" and any(i.get("id") == before["id"] and i.get("locked") is False for i in o.get("value", [])) for o in ops if o.get("type") == "UPDATE_CONSTRAINT")
            if before.get("locked") and current_intents.get(before["id"]) != before:
                # Intent unlock must itself be an explicit user constraint edit.
                if not unlock:
                    fail("LOCKED_INTENT_CHANGED", "锁定意图未经明确解锁不能修改或删除。", [before["activityId"]] if before.get("activityId") else [])
            if before.get("locked") and before.get("activityId") and not unlock:
                prior_activity = next((a for a in old["activities"] if a["id"] == before["activityId"]), None)
                after = by_id.get(before["activityId"])
                if prior_activity and (after is None or _activity_changed(prior_activity, after, protected_fields)):
                    fail("LOCKED_INTENT_CHANGED", "锁定任务关联活动不能被移动、替换或删除。", [before["activityId"]])
        for key in ("budgetCny", "budgetScope", "budgetIsHardLimit", "mustVisit", "fixedConstraints", "arrivalAt", "departureAt", "dailyStartTime", "dailyEndTime", "startDate", "endDate", "startPoint", "endPoint", "includesAccommodation", "includesIntercityTransport"):
            if old["requirements"].get(key) != req.get(key) and key not in explicitly_changed:
                fail("IMPLICIT_CONSTRAINT_CHANGE", f"约束{key}没有对应的用户明确修改操作。")
        if old["tripId"] != p["tripId"] or old["revision"] != p["revision"]:
            fail("STALE_REVISION", "候选必须保留原行程ID与基础revision。")
        for operation in ops:
            after = by_id.get(operation.get("activityId"))
            if after and operation.get("type") == "UPDATE_TIME" and moment(after["startAt"]) != moment(operation["startAt"]):
                # Only the final operation addressing a field defines its value.
                later = ops[ops.index(operation) + 1:]
                if not any(o.get("activityId") == after["id"] and o.get("type") in {"UPDATE_TIME", "REMOVE"} for o in later):
                    fail("REQUESTED_TIME_CHANGED", "重新排程改变了用户明确指定的时间，需要重新提案。", [after["id"]])

    return ValidationReport.model_validate({"status": "INFEASIBLE" if hard else "PARTIALLY_VERIFIED" if unknown else "FEASIBLE", "hardViolations": hard, "unknownChecks": unknown, "warnings": warnings, "committable": not hard and not blocking_unknown})
