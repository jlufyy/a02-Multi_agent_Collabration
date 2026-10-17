"""A6 policy evaluation. Returned cards are candidates; only clients can record shownAt."""
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from uuid import uuid4

from .jobs import dump


def instant(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def distance(a, b):
    lat1, lat2 = radians(a["lat"]), radians(b["lat"])
    dlat, dlng = lat2-lat1, radians(b["lng"]-a["lng"])
    return 6371000 * 2 * asin(min(1, sqrt(sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlng/2)**2)))


def evaluate_notification(request):
    from .geo_policy import geo_policy
    geo = geo_policy()
    req = dump(request)
    trip, event = req["tripState"], req["currentEvent"]
    policy, at = trip["notificationPolicy"], instant(event["occurredAt"])
    base = {"decisionId": uuid4().hex, "eventId": event["eventId"], "tripId": trip["tripId"],
            "baseRevision": trip["revision"]}

    def suppress(code):
        return {**base, "shouldNotify": False, "reasonCode": code, "suppressionReason": code}

    if trip["mode"] != "TRAVELING":
        return suppress("NOT_TRAVELING")
    if event["type"] not in ("ARRIVE", "RISK", "RESUME"):
        return suppress("NO_ACTIONABLE_EVENT")
    activity = next((a for a in trip["activities"] if a["id"] == event.get("activityId")), None)
    intents = [i for i in trip["intents"] if i["confirmed"] and i["status"] not in ("CANCELLED",)
               and activity and (i.get("activityId") == activity["id"] or
                                  (i.get("placeId") == activity["place"]["poiId"] and not i.get("activityId")))]
    personal = next((i for i in intents if i["type"] not in ("KNOWLEDGE", "FOOD")), None)
    knowledge = next((i for i in intents if i["type"] == "KNOWLEDGE"), None)
    food = next((i for i in intents if i["type"] == "FOOD"), None)
    intent = personal or food or knowledge
    risk = event.get("risk")
    facts = []
    if event["type"] == "RISK":
        if not risk or not risk.get("evidence"):
            return suppress("RISK_EVIDENCE_MISSING")
        facts = risk["evidence"]
        if event["source"] != "SIMULATED":
            # Never accept a client-supplied free-form VERIFIED label as proof of risk.
            from .validation import validate_plan
            report = dump(validate_plan(request.tripState))
            supported = [v for v in report["hardViolations"] if v["code"] == risk["code"]
                         and set(risk["activityIds"]).issubset(v["activityIds"])]
            if not supported:
                return suppress("RISK_NOT_REPRODUCIBLE")
        level, module, title = "L3", "TRIP_RISK", risk["message"]
        actions = ["VIEW_REVISION", "IGNORE"]
    else:
        if not activity or not event.get("arrivalId"):
            return suppress("ARRIVAL_CONTEXT_MISSING")
        if activity["progress"] not in ("ARRIVED", "VISITING"):
            return suppress("ARRIVAL_NOT_CONFIRMED_BY_LOCAL_ENGINE")
        if event.get("accuracyMeters", float("inf")) > geo.maxAccuracyMeters or not event.get("location"):
            return suppress("LOCATION_UNCERTAIN")
        if at.astimezone(timezone(timedelta(hours=8))).date() != instant(activity["startAt"]).date():
            return suppress("ARRIVAL_DATE_MISMATCH")
        point = event["location"]
        target = activity["place"]["location"]
        if point["coordinateSystem"] != target["coordinateSystem"]:
            from .providers import to_gcj02
            point, target = to_gcj02(point), to_gcj02(target)
        if distance(point, target) > geo.departureRadiusMeters:
            return suppress("OUTSIDE_PLACE")
        if not intent:
            return suppress("NO_RELEVANT_CONFIRMED_INTENT")
        level = "L2" if personal else "L1"
        module = "PERSONAL_GOAL" if personal else ("NEARBY" if food else "KNOWLEDGE")
        title = f"{activity['place']['name']}：{intent['userRequest']}"
        actions = ["VIEW_SCRIPT", "VIEW_SHOOTING_CHECKLIST", "REMIND_LATER", "IGNORE"] if personal else ["VIEW_NEARBY" if food else "VIEW_CONTENT", "IGNORE"]
        facts = activity["place"]["evidence"]
    if not policy["enable" + level]:
        return suppress("LEVEL_DISABLED")
    if level != "L3" and (policy["paused"] or req["uiBusy"]):
        return suppress("PAUSED" if policy["paused"] else "UI_BUSY")
    records = [r for r in req["recentNotifications"]
               if r["source"] == event["source"] and r.get("demoRunId") == event.get("demoRunId")]
    for record in records:
        same = (record.get("riskCode") == risk["code"] if level == "L3" else
                record.get("arrivalId") == event.get("arrivalId") and record.get("activityId") == activity["id"]
                and (level == "L1" and record["level"] == "L1" or level == "L2" and record.get("intentId") == intent["id"]))
        if same:
            until = record.get("snoozeUntil")
            if until and instant(until) > at:
                return suppress("SNOOZED")
            if record.get("actionTaken") == "IGNORE":
                return suppress("USER_IGNORED")
            if record.get("shownAt") and not (until and instant(until) <= at and record.get("actionTaken") == "REMIND_LATER"):
                return suppress("ALREADY_SHOWN")
        if level != "L3" and record.get("shownAt"):
            elapsed = at - instant(record["shownAt"])
            if timedelta(0) <= elapsed < timedelta(minutes=policy["cooldownMinutes"]):
                return suppress("COOLDOWN")
    card = {"cardId": uuid4().hex, "level": level, "module": module, "title": title,
            "actions": actions, "contentIds": [],
            "evidence": {"source": event["source"], "eventId": event["eventId"], "facts": facts}}
    if activity:
        card["activityId"] = activity["id"]
    if intent and level != "L3":
        card["intentId"] = intent["id"]
    return {**base, "shouldNotify": True, "reasonCode": "VERIFIED_RISK" if level == "L3" else "CONFIRMED_INTENT_ARRIVAL", "card": card}
