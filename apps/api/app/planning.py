"""A4 deterministic draft scheduling, sequential copy edits, and visible diffs.

Providers supply POIs/routes; this module never invents their facts. Initial
slots are provisional until actual route durations have been injected and A5
has validated the rescheduled candidate.
"""
from __future__ import annotations

import copy
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from .schemas import RevisionProposal, TripRequirements, TripState
from .validation import _opening_windows, as_dict, expected_edges, moment, ordered_activities, validate_plan, verified

TZ = timezone(timedelta(hours=8))
PROJECTIONS = ("destinationCity", "startDate", "endDate", "travelerCount", "budgetCny", "budgetScope", "companions", "preferences", "intents")
CONSTRAINT_KEYS = {"budgetCny", "budgetScope", "budgetIsHardLimit", "includesAccommodation", "includesIntercityTransport", "transportModes", "preferences", "companions", "specialNeeds", "walkingTolerance", "startDate", "endDate", "arrivalAt", "departureAt", "dailyStartTime", "dailyEndTime", "startPoint", "endPoint", "mustVisit", "avoidPlaces", "fixedConstraints", "intents", "activityLocked"}


class PlanningError(ValueError):
    def __init__(self, code: str, message: str, activity_ids: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.activity_ids = activity_ids or []


def _iso(value: datetime) -> str:
    if value.microsecond:
        value += timedelta(microseconds=1_000_000-value.microsecond)
    return value.astimezone(TZ).isoformat(timespec="seconds")


def _now() -> str:
    return _iso(datetime.now(TZ))


def _clock(day: date, clock: str) -> datetime:
    return moment(f"{day.isoformat()}T{clock}:00+08:00")


def _sync(p: dict) -> None:
    for key in PROJECTIONS:
        if key in p["requirements"]:
            p[key] = copy.deepcopy(p["requirements"][key])
        else:
            p.pop(key, None)


def _reindex(p: dict) -> None:
    p["activities"].sort(key=lambda a: (a["dayIndex"], a["orderIndex"]))
    counts: dict[int, int] = {}
    for activity in p["activities"]:
        day = activity["dayIndex"]
        activity["orderIndex"] = counts.get(day, 0)
        counts[day] = counts.get(day, 0) + 1


def _known_price(place: dict, count: int) -> tuple[float | None, str]:
    fact = place.get("ticketPriceCny") or {}
    if fact.get("value") is not None and fact.get("evidence", {}).get("status") in {"VERIFIED", "ESTIMATED"}:
        return fact["value"] * count, fact["evidence"]["status"]
    return None, "UNKNOWN"


def _stable_id(trip_id: str, poi_id: str, occurrence: int = 0) -> str:
    return "activity-" + uuid.uuid5(uuid.NAMESPACE_URL, f"tripflow:{trip_id}:{poi_id}:{occurrence}").hex[:20]


def build_plan(trip_id: str, requirements: Any, places: Iterable[Any], mode: str = "PLANNING") -> TripState:
    req = TripRequirements.model_validate(as_dict(requirements))
    req.require_confirmed()
    r = as_dict(req)
    first, last = date.fromisoformat(r["startDate"]), date.fromisoformat(r["endDate"])
    days = (last - first).days + 1
    candidates = {as_dict(place)["poiId"]: copy.deepcopy(as_dict(place)) for place in places}
    # Explicitly resolved must-visit/fixed POIs may be supplied through requirements.
    for reference in r["mustVisit"] + [c["place"] for c in r["fixedConstraints"] if c.get("place")]:
        if reference.get("place"):
            candidates.setdefault(reference["place"]["poiId"], reference["place"])
    avoids = {ref["place"]["poiId"] for ref in r["avoidPlaces"] if ref.get("place")}
    must = {ref["place"]["poiId"] for ref in r["mustVisit"] if ref.get("place")}
    fixed_places = {c["place"]["place"]["poiId"] for c in r["fixedConstraints"] if c.get("place", {}).get("place")}
    intent_places = {i["placeId"] for i in r["intents"] if i.get("placeId") and i["status"] != "CANCELLED" and (i.get("confirmed") or i.get("locked"))}
    required_places = must | fixed_places | intent_places
    interests = list(r["preferences"]) + [interest for companion in r["companions"] for interest in companion["interests"]]
    coverage = {c["id"]: 0 for c in r["companions"]}
    remaining = [p for p in candidates.values() if p["poiId"] not in avoids or p["poiId"] in required_places]
    selected = []
    # Fairness: boost still-unserved companion interests, with deterministic ties.
    while remaining:
        def score(place: dict) -> tuple:
            text = " ".join((place["name"], place.get("address") or "")).casefold()
            fair = sum(sum(1 for i in c["interests"] if i.casefold() in text) / (1 + coverage[c["id"]]) for c in r["companions"])
            # Coarse geometry only ranks candidates; actual routes still determine feasibility.
            reference = selected[-1]["location"] if selected else next((p["location"] for p in remaining if p["poiId"] in required_places), place["location"])
            point = place["location"]
            proximity = (point["lat"]-reference["lat"])**2 + ((point["lng"]-reference["lng"]) * math.cos(math.radians(reference["lat"])))**2
            return (place["poiId"] not in required_places, -fair, -sum(i.casefold() in text for i in interests), proximity, place["poiId"])
        place = min(remaining, key=score)
        remaining.remove(place)
        selected.append(place)
        for companion in r["companions"]:
            if any(i.casefold() in place["name"].casefold() for i in companion["interests"]):
                coverage[companion["id"]] += 1

    # 90 minutes is a visible provisional activity duration, not a provider fact.
    low_walking = r.get("walkingTolerance") == "LOW" or any(c.get("walkingTolerance") == "LOW" for c in r["companions"])
    slot_minutes = 120 if low_walking else 90
    # Keep a small number per day to leave actual travel/meal/rest capacity.
    required_count = len(required_places)
    capacity = max(required_count, days * (2 if low_walking else 3))
    def family(place):
        seen = set()
        while place["poiId"] not in seen:
            seen.add(place["poiId"])
            parent = place.get("parentPoiId") or {}
            if not parent.get("value") or not verified(parent.get("evidence")):
                return place["poiId"]
            if parent["value"] not in candidates:
                return parent["value"]
            place = candidates[parent["value"]]
        return min(seen)
    protected_families = {family(p) for p in selected if p["poiId"] in required_places}
    used_families = set(protected_families)
    grouped = []
    for place in selected:
        group = family(place)
        if place["poiId"] not in required_places and group in used_families:
            continue
        grouped.append(place)
        used_families.add(group)
    selected = grouped[:capacity]
    per_day = max(1, math.ceil(len(selected) / days))
    activities = []
    day_counts: dict[int, int] = {}
    cursor_by_day = {}
    for index, place in enumerate(selected):
        fixed = next((c for c in r["fixedConstraints"] if c.get("place", {}).get("place", {}).get("poiId") == place["poiId"]), None)
        day_index = (moment(fixed["startAt"]).date() - first).days if fixed else min(index // per_day, days - 1)
        if not 0 <= day_index < days:
            raise PlanningError("TIME_WINDOW_VIOLATION", "固定安排的日期超出本次行程，请调整日期或固定条件。")
        calendar = first + timedelta(days=day_index)
        start = cursor_by_day.get(day_index, _clock(calendar, r.get("dailyStartTime") or "09:00"))
        if day_index == 0 and r.get("arrivalAt"):
            start = max(start, moment(r["arrivalAt"]))
        if fixed:
            start = moment(fixed["startAt"])
        elif start.date() != calendar:
            # Keep a schema-valid draft for A5 to explain, never wrap into tomorrow.
            start = _clock(calendar, r.get("dailyStartTime") or "09:00")
        end = moment(fixed["endAt"]) if fixed and fixed.get("endAt") else start + timedelta(minutes=slot_minutes)
        cursor_by_day[day_index] = end
        cost, status = _known_price(place, r["travelerCount"])
        activity = {"id": fixed.get("activityId") if fixed and fixed.get("activityId") else _stable_id(trip_id, place["poiId"]), "place": place, "dayIndex": day_index, "orderIndex": day_counts.get(day_index, 0), "startAt": _iso(start), "endAt": _iso(end), "costStatus": status, "locked": bool(fixed and fixed.get("locked")), "mandatory": place["poiId"] in must, "progress": "NOT_STARTED", "intentIds": [], "bookingStatus": "UNSPECIFIED"}
        if cost is not None:
            activity["estimatedCostCny"] = cost
        activities.append(activity)
        day_counts[day_index] = day_counts.get(day_index, 0) + 1
    # Two appointments at the same POI on different dates are separate visits.
    for place_id in fixed_places:
        fixed_visits = [c for c in r["fixedConstraints"] if c.get("place", {}).get("place", {}).get("poiId") == place_id]
        for occurrence, fixed in enumerate(fixed_visits[1:], start=1):
            source = next(a for a in activities if a["place"]["poiId"] == place_id)
            activity = copy.deepcopy(source)
            start = moment(fixed["startAt"])
            day_index = (start.date() - first).days
            if not 0 <= day_index < days:
                raise PlanningError("TIME_WINDOW_VIOLATION", "固定安排的日期超出本次行程，请调整日期或固定条件。")
            end = moment(fixed["endAt"]) if fixed.get("endAt") else start + timedelta(minutes=slot_minutes)
            activity.update(id=fixed.get("activityId") or _stable_id(trip_id, place_id, occurrence), dayIndex=day_index, orderIndex=day_counts.get(day_index, 0), startAt=_iso(start), endAt=_iso(end), locked=bool(fixed.get("locked")))
            activities.append(activity)
            day_counts[day_index] = day_counts.get(day_index, 0) + 1
    activities.sort(key=lambda a: (a["dayIndex"], a["startAt"], a["id"]))
    counts = {}
    for activity in activities:
        day_index = activity["dayIndex"]
        activity["orderIndex"] = counts.get(day_index, 0)
        counts[day_index] = counts.get(day_index, 0) + 1
    # A locked intent binds only by explicit stable identity, never fuzzy query.
    for intent in r["intents"]:
        activity = next((a for a in activities if a["id"] == intent.get("activityId")), None)
        if activity is None and intent.get("placeId"):
            activity = next((a for a in activities if a["place"]["poiId"] == intent["placeId"]), None)
        if activity:
            intent["activityId"] = activity["id"]
            intent["placeId"] = activity["place"]["poiId"]
            activity["intentIds"].append(intent["id"])
    p = {"schemaVersion": 1, "tripId": trip_id, "revision": 0, "title": f"{r['destinationCity']}{days}日行程", "mode": mode, "lifecycle": "PLANNING" if mode == "PLANNING" else "TRAVELING", "requirements": r, "activities": activities, "segments": [], "boundarySegments": [], "notificationPolicy": {"enableL1": True, "enableL2": True, "enableL3": True, "paused": False, "cooldownMinutes": 15}, "updatedAt": _now()}
    _sync(p)
    _reindex(p)
    return reschedule(TripState.model_validate(p))


def _anchor(activity: dict, req: dict, pinned: set[str]) -> bool:
    if activity.get("progress") in ("ARRIVED", "VISITING", "INFERRED_COMPLETE"):
        return True
    return activity["id"] in pinned or activity.get("locked", False) or activity.get("bookingStatus") == "BOOKED" or any(c.get("activityId") == activity["id"] or c.get("place", {}).get("place", {}).get("poiId") == activity["place"]["poiId"] for c in req["fixedConstraints"]) or any(i.get("locked") and i.get("activityId") == activity["id"] for i in req["intents"])


def reschedule(plan: Any, preserve_activity_ids: Iterable[str] = ()) -> TripState:
    """Shift unlocked downstream slots using supplied, verified travel durations.

    It deliberately leaves an infeasible anchor in place for A5 to explain.
    Missing travel time is not replaced by invented straight-line travel.
    """
    p = copy.deepcopy(as_dict(plan))
    req = p["requirements"]
    _reindex(p)
    routes = {(s["fromActivityId"], s["toActivityId"]): s for s in p["segments"]}
    pinned = set(preserve_activity_ids)
    previous = None
    first = date.fromisoformat(p["startDate"])
    for activity in p["activities"]:
        calendar = first + timedelta(days=activity["dayIndex"])
        old_start, old_end = moment(activity["startAt"]), moment(activity["endAt"])
        duration = old_end - old_start
        earliest = _clock(calendar, req.get("dailyStartTime") or "09:00")
        if req.get("arrivalAt") and activity["dayIndex"] == 0:
            earliest = max(earliest, moment(req["arrivalAt"]))
        if previous and previous["dayIndex"] == activity["dayIndex"]:
            earliest = max(earliest, moment(previous["endAt"]))
            route = routes.get((previous["id"], activity["id"]))
            if route and route.get("durationMin") is not None and verified(route.get("evidence")):
                earliest = max(earliest, moment(previous["endAt"]) + timedelta(minutes=route["durationMin"]))
        elif activity["dayIndex"] == 0:
            for segment in p["boundarySegments"]:
                if segment["from"].get("kind") == "START_POINT" and segment["to"].get("activityId") == activity["id"] and req.get("arrivalAt") and segment.get("durationMin") is not None and verified(segment.get("evidence")):
                    earliest = max(earliest, moment(req["arrivalAt"]) + timedelta(minutes=segment["durationMin"]))
        if not _anchor(activity, req, pinned):
            same_day_start = old_start.replace(year=calendar.year, month=calendar.month, day=calendar.day)
            start = max(same_day_start, earliest)
            opening = activity["place"].get("openingHours") or {}
            windows = _opening_windows(opening.get("value", "")) if verified(opening.get("evidence")) else None
            if windows:
                midnight = _clock(calendar, "00:00")
                for lower, upper in windows:
                    available = max(start, midnight + timedelta(minutes=lower))
                    if available + duration <= midnight + timedelta(minutes=upper):
                        start = available
                        break
            upper = _clock(calendar, req.get("dailyEndTime") or "23:59")
            if req.get("departureAt"):
                upper = min(upper, moment(req["departureAt"]))
            if start + duration <= upper and start.date() == calendar:
                activity["startAt"], activity["endAt"] = _iso(start), _iso(start + duration)
            # Otherwise retain the original same-day slot. A5 reports the real
            # transit/window conflict; bounded repair may remove optional stops.
            # Do not clamp duration or create a next-day activity with this dayIndex.
        previous = activity
    p["updatedAt"] = _now()
    return TripState.model_validate(p)


def _prune_routes(p: dict, before: dict) -> None:
    """Keep only still-adjacent routes with the same POIs, date and modes."""
    old = {a["id"]: a for a in before["activities"]}
    new = {a["id"]: a for a in p["activities"]}
    def unchanged(aid: str) -> bool:
        return aid in old and aid in new and old[aid]["place"] == new[aid]["place"] and old[aid]["dayIndex"] == new[aid]["dayIndex"] and old[aid]["startAt"][:10] == new[aid]["startAt"][:10]
    edges = expected_edges(p)
    p["segments"] = [s for s in p["segments"] if (s["fromActivityId"], s["toActivityId"]) in edges and unchanged(s["fromActivityId"]) and unchanged(s["toActivityId"]) and old[s["fromActivityId"]]["endAt"] == new[s["fromActivityId"]]["endAt"] and s["mode"] in p["requirements"]["transportModes"]]
    activities = ordered_activities(p)
    boundaries = []
    for segment in p["boundarySegments"]:
        start = segment["from"].get("kind") == "START_POINT"
        endpoint = segment["to"] if start else segment["from"]
        kind_key = "startPoint" if start else "endPoint"
        reference = p["requirements"].get(kind_key) or {}
        boundary_endpoint = segment["from"] if start else segment["to"]
        last = activities[0] if start and activities else activities[-1] if activities else None
        departure_same = (p["requirements"].get("arrivalAt") == before["requirements"].get("arrivalAt")) if start else (last and old.get(last["id"], {}).get("endAt") == last["endAt"])
        if departure_same and last and endpoint.get("activityId") == last["id"] and unchanged(last["id"]) and reference.get("place") == boundary_endpoint.get("place") and segment["mode"] in p["requirements"]["transportModes"]:
            boundaries.append(segment)
    p["boundarySegments"] = boundaries


def apply_operations(plan: Any, operations: Iterable[Any]) -> TripState:
    """Apply an entire ordered batch on a deep copy; never modify the source."""
    original = as_dict(plan)
    p = copy.deepcopy(original)
    req = p["requirements"]
    ops = [as_dict(raw) for raw in operations]
    constraint_keys = {o["key"] for o in ops if o.get("type") == "UPDATE_CONSTRAINT"}
    for op in ops:
        kind = op["type"]
        activity = next((a for a in p["activities"] if a["id"] == op.get("activityId")), None)
        if kind not in {"ADD", "UPDATE_CONSTRAINT"} and activity is None:
            raise PlanningError("ACTIVITY_NOT_FOUND", "操作引用的稳定活动ID不存在。", [op["activityId"]])
        if activity is not None:
            if activity.get("progress") in ("ARRIVED", "VISITING", "INFERRED_COMPLETE"):
                raise PlanningError("ACTIVITY_PROGRESS_PROTECTED", "进行中或已完成的活动不能自动重排，请先明确纠正状态。", [activity["id"]])
            if activity.get("locked"):
                raise PlanningError("LOCKED_ACTIVITY_CHANGED", "请先明确解锁活动，再执行编辑。", [activity["id"]])
            if any(i.get("locked") and (i.get("activityId") == activity["id"] or i["id"] in activity["intentIds"]) for i in req["intents"]):
                raise PlanningError("LOCKED_INTENT_CHANGED", "锁定任务关联活动不能被编辑。", [activity["id"]])
            if activity.get("bookingStatus") == "BOOKED":
                raise PlanningError("BOOKED_ACTIVITY_CHANGED", "已预订活动不能自动修改。", [activity["id"]])
            if any(c.get("activityId") == activity["id"] or c.get("place", {}).get("place", {}).get("poiId") == activity["place"]["poiId"] for c in req["fixedConstraints"]):
                raise PlanningError("FIXED_CONSTRAINT_VIOLATION", "请先明确调整固定条件，再修改关联活动。", [activity["id"]])
        if kind == "ADD":
            addition = copy.deepcopy(as_dict(op["activity"]))
            if any(a["id"] == addition["id"] for a in p["activities"]):
                raise PlanningError("DUPLICATE_ACTIVITY_ID", "新增活动ID已经存在。", [addition["id"]])
            day = [a for a in p["activities"] if a["dayIndex"] == addition["dayIndex"]]
            if addition["orderIndex"] > len(day):
                raise PlanningError("ORDER_INDEX_INVALID", "新增活动的插入索引超出当日范围。")
            for a in day:
                if a["orderIndex"] >= addition["orderIndex"]:
                    a["orderIndex"] += 1
            p["activities"].append(addition)
        elif kind == "REMOVE":
            p["activities"].remove(activity)
            # Unlocked tasks are cancelled visibly; locked tasks were rejected above.
            for intent in req["intents"]:
                if intent.get("activityId") == activity["id"]:
                    intent["status"] = "CANCELLED"
                    intent.pop("activityId", None)
                    intent["preparedContentIds"] = []
        elif kind == "REPLACE":
            replacement = as_dict(op["candidatePlace"])
            if replacement["poiId"] != op["candidatePlaceId"]:
                raise PlanningError("PLACE_ID_MISMATCH", "替换地点ID与地点对象不一致。")
            activity["place"] = copy.deepcopy(replacement)
            cost, status = _known_price(replacement, p["travelerCount"])
            activity["costStatus"] = status
            activity.pop("estimatedCostCny", None)
            if cost is not None:
                activity["estimatedCostCny"] = cost
            for intent in req["intents"]:
                if intent.get("activityId") == activity["id"]:
                    intent["placeId"] = replacement["poiId"]
                    intent["preparedContentIds"] = []
                    intent["status"] = "PENDING"
        elif kind == "MOVE":
            p["activities"].remove(activity)
            _reindex(p)
            day = [a for a in p["activities"] if a["dayIndex"] == op["dayIndex"]]
            if not 0 <= op["orderIndex"] <= len(day):
                raise PlanningError("ORDER_INDEX_INVALID", "移动索引指从原序列移除后插入的最终索引。", [activity["id"]])
            for a in day:
                if a["orderIndex"] >= op["orderIndex"]:
                    a["orderIndex"] += 1
            activity["dayIndex"], activity["orderIndex"] = op["dayIndex"], op["orderIndex"]
            start, end = moment(activity["startAt"]), moment(activity["endAt"])
            calendar = date.fromisoformat(p["startDate"]) + timedelta(days=op["dayIndex"])
            new_start = start.replace(year=calendar.year, month=calendar.month, day=calendar.day)
            activity["startAt"], activity["endAt"] = _iso(new_start), _iso(new_start + (end - start))
            p["activities"].append(activity)
        elif kind == "UPDATE_TIME":
            duration = moment(activity["endAt"]) - moment(activity["startAt"])
            start = moment(op["startAt"])
            activity["startAt"], activity["endAt"] = _iso(start), _iso(start + duration)
        elif kind == "UPDATE_DURATION":
            if op["durationMin"] <= 0:
                raise PlanningError("INVALID_DURATION", "活动时长必须为正数。", [activity["id"]])
            activity["endAt"] = _iso(moment(activity["startAt"]) + timedelta(minutes=op["durationMin"]))
        elif kind == "UPDATE_CONSTRAINT":
            key, value = op["key"], copy.deepcopy(op["value"])
            if key == "activityLocked":
                target = next((a for a in p["activities"] if a["id"] == value["activityId"]), None)
                if target is None:
                    raise PlanningError("ACTIVITY_NOT_FOUND", "锁定操作引用的活动不存在。", [value["activityId"]])
                target["locked"] = value["locked"]
            else:
                if key not in CONSTRAINT_KEYS:
                    raise PlanningError("CONSTRAINT_NOT_ALLOWED", "不支持的约束字段。")
                req[key] = value
                req["version"] += 1
                _sync(p)
                if key == "intents":
                    for a in p["activities"]:
                        a["intentIds"] = [i["id"] for i in req["intents"] if i.get("activityId") == a["id"]]
        else:
            raise PlanningError("OPERATION_NOT_ALLOWED", "不支持的操作类型。")
        _reindex(p)
    _sync(p)
    if p["startDate"] != original["startDate"]:
        def date_protected(a):
            return a.get("locked") or a.get("bookingStatus") == "BOOKED" or any(i.get("locked") and i.get("activityId") == a["id"] for i in req["intents"]) or ("fixedConstraints" not in constraint_keys and _anchor(a, req, set()))
        protected = [a["id"] for a in p["activities"] if date_protected(a) and moment(a["startAt"]).date() != date.fromisoformat(p["startDate"]) + timedelta(days=a["dayIndex"])]
        if protected:
            raise PlanningError("TIME_WINDOW_VIOLATION", "修改出发日期会移动锁定、预订或固定任务，请先明确调整这些约束。", protected)
        for activity in p["activities"]:
            start, end = moment(activity["startAt"]), moment(activity["endAt"])
            calendar = date.fromisoformat(p["startDate"]) + timedelta(days=activity["dayIndex"])
            shifted = start.replace(year=calendar.year, month=calendar.month, day=calendar.day)
            activity["startAt"], activity["endAt"] = _iso(shifted), _iso(shifted + (end - start))
    if "fixedConstraints" in constraint_keys:
        assigned = set()
        for constraint in req["fixedConstraints"]:
            matching = [
                a for a in p["activities"] if a["id"] not in assigned
                and (a["id"] == constraint.get("activityId")
                     or (not constraint.get("activityId")
                         and a["place"]["poiId"] == constraint.get("place", {}).get("place", {}).get("poiId")))
            ]
            if matching:
                fixed_start = moment(constraint["startAt"])
                matching = [min(matching, key=lambda a: (abs((moment(a["startAt"]) - fixed_start).total_seconds()), a["id"]))]
                assigned.add(matching[0]["id"])
            for activity in matching:
                start, end = moment(activity["startAt"]), moment(activity["endAt"])
                fixed_start = moment(constraint["startAt"])
                fixed_end = moment(constraint["endAt"]) if constraint.get("endAt") else fixed_start + (end - start)
                if (start, end) != (fixed_start, fixed_end):
                    if activity.get("locked") or activity.get("bookingStatus") == "BOOKED" or any(i.get("locked") and i.get("activityId") == activity["id"] for i in req["intents"]):
                        raise PlanningError("LOCKED_ACTIVITY_CHANGED", "调整固定集合不能隐式移动仍锁定、已预订或有关联锁定任务的活动。", [activity["id"]])
                    activity.update(startAt=_iso(fixed_start), endAt=_iso(fixed_end), dayIndex=(fixed_start.date() - date.fromisoformat(p["startDate"])).days)
    last_day = (date.fromisoformat(p["endDate"]) - date.fromisoformat(p["startDate"])).days
    for activity in p["activities"]:
        if activity["dayIndex"] > last_day:
            if _anchor(activity, req, set()):
                raise PlanningError("TIME_WINDOW_VIOLATION", "缩短行程会移除锁定、预订或固定任务所在日期。", [activity["id"]])
            delta = timedelta(days=last_day - activity["dayIndex"])
            activity["dayIndex"] = last_day
            activity["startAt"] = _iso(moment(activity["startAt"]) + delta)
            activity["endAt"] = _iso(moment(activity["endAt"]) + delta)
    _reindex(p)
    _prune_routes(p, original)
    p["updatedAt"] = _now()
    for activity in p["activities"]:
        calendar = date.fromisoformat(p["startDate"]) + timedelta(days=activity["dayIndex"])
        if not 0 <= activity["dayIndex"] <= last_day or moment(activity["startAt"]).date() != calendar or moment(activity["endAt"]).date() != calendar:
            raise PlanningError("TIME_WINDOW_VIOLATION", "本次修改使活动跨日，请调整日期或时长。", [activity["id"]])
    return TripState.model_validate(p)


def _travel_total(p: dict) -> float | None:
    routes = p["segments"] + p["boundarySegments"]
    if expected_edges(p) - {(s["fromActivityId"], s["toActivityId"]) for s in p["segments"]}:
        return None
    if p["requirements"].get("startPoint") and not any(s["from"].get("kind") == "START_POINT" for s in p["boundarySegments"]):
        return None
    if p["requirements"].get("endPoint") and not any(s["to"].get("kind") == "END_POINT" for s in p["boundarySegments"]):
        return None
    return sum(s["durationMin"] for s in routes) if all(s.get("durationMin") is not None and verified(s.get("evidence")) for s in routes) else None


def _cost_total(p: dict) -> float | None:
    # No route fare/accommodation/intercity cost fields exist in v1. A total
    # delta must not quietly count these requested/used items as free.
    if p["segments"] or p["boundarySegments"] or p["requirements"].get("includesAccommodation") or p["requirements"].get("includesIntercityTransport"):
        return None
    if any(a.get("estimatedCostCny") is None or a.get("costStatus") != "VERIFIED" for a in p["activities"]):
        return None
    return sum(a["estimatedCostCny"] for a in p["activities"])


def build_proposal(original: Any, candidate: Any, operations: Iterable[Any], rejection: PlanningError | None = None) -> RevisionProposal:
    old, new = as_dict(original), as_dict(candidate)
    ops = [as_dict(o) for o in operations]
    report = validate_plan(candidate, original, ops)
    if rejection is not None:
        raw_report = as_dict(report)
        raw_report.update(status="INFEASIBLE", committable=False)
        raw_report["hardViolations"].append({"code": rejection.code, "activityIds": rejection.activity_ids, "message": rejection.message})
        report = type(report).model_validate(raw_report)
    before, after = {a["id"]: a for a in old["activities"]}, {a["id"]: a for a in new["activities"]}
    shared = before.keys() & after.keys()
    changes = []
    for aid in sorted(before.keys() | after.keys()):
        a, b = before.get(aid), after.get(aid)
        fields = sorted(k for k in ((a or {}).keys() | (b or {}).keys()) if (a or {}).get(k) != (b or {}).get(k))
        if fields:
            change = {"activityId": aid, "fields": fields}
            if a:
                change.update(oldStartAt=a["startAt"], oldEndAt=a["endAt"])
            if b:
                change.update(newStartAt=b["startAt"], newEndAt=b["endAt"])
            changes.append(change)
    estimated_changes = {}
    old_travel, new_travel = _travel_total(old), _travel_total(new)
    old_cost, new_cost = _cost_total(old), _cost_total(new)
    if old_travel is not None and new_travel is not None:
        estimated_changes["travelMinutesDelta"] = new_travel - old_travel
    if old_cost is not None and new_cost is not None:
        estimated_changes["costCnyDelta"] = new_cost - old_cost
    return RevisionProposal.model_validate({"proposalId": "proposal-" + uuid.uuid4().hex, "tripId": old["tripId"], "baseRevision": old["revision"], "operations": ops, "candidate": new, "hardViolations": as_dict(report)["hardViolations"], "unknownChecks": report.unknownChecks, "diff": {"added": sorted(after.keys() - before.keys()), "removed": sorted(before.keys() - after.keys()), "moved": sorted(aid for aid in shared if (before[aid]["dayIndex"], before[aid]["orderIndex"]) != (after[aid]["dayIndex"], after[aid]["orderIndex"]))}, "estimatedChanges": estimated_changes, "validation": as_dict(report), "activityChanges": changes})
