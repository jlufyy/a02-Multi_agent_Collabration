"""Opt-in smoke against a running local server; invokes configured paid APIs."""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import time
from uuid import uuid4

import httpx


def main():
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "evidenceType": "LIVE_LOCAL_HTTP"}
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=50) as client:
        health = client.get("/api/v1/health")
        health.raise_for_status()
        report.update(healthHTTP=health.status_code, serviceStatus=health.json()["data"]["serviceStatus"],
                      modelRoutes=health.json()["data"]["capabilities"]["modelRoutes"])
        for name, path in (("openapiHTTP", "/openapi.json"), ("docsHTTP", "/docs")):
            response = client.get(path)
            response.raise_for_status()
            report[name] = response.status_code
        places = client.post("/api/v1/places/search", headers={"X-Request-Id": uuid4().hex},
                             json={"executionMode": "REAL", "city": "北京", "keyword": "天坛公园"})
        places.raise_for_status()
        report.update(searchHTTP=places.status_code, searchCount=len(places.json()["data"]["places"]))
        day = (date.today()+timedelta(days=7)).isoformat()
        accepted = client.post("/api/v1/requirements/parse", headers={"X-Request-Id": uuid4().hex},
                               json={"executionMode": "REAL", "tripId": "http-smoke", "baseRevision": 0,
                                     "text": f"{day}去北京一日游，2人，总预算1000元，喜欢历史文化，步行和公交。"})
        accepted.raise_for_status()
        assert accepted.status_code == 202
        started = time.monotonic()
        while time.monotonic()-started < 190:
            response = client.get("/api/v1/jobs/"+accepted.json()["data"]["jobId"])
            response.raise_for_status()
            snapshot = response.json()
            if snapshot["status"] in ("SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"):
                report.update(parseAcceptedHTTP=accepted.status_code, parseJobStatus=snapshot["status"],
                              parseElapsedSeconds=round(time.monotonic()-started, 2),
                              progressEventCount=len(snapshot["data"]["progressEvents"]))
                if snapshot["status"] in ("SUCCEEDED", "PARTIAL"):
                    requirements = snapshot["data"]["result"]["requirements"]
                    report["parseMatchesRequest"] = (requirements["destinationCity"] == "北京"
                        and requirements["travelerCount"] == 2 and requirements["startDate"] == day
                        and requirements["confirmed"] is False)
                else:
                    report["errorCodes"] = [error["code"] for error in snapshot["errors"]]
                break
            time.sleep(1)
        else:
            report["parseJobStatus"] = "SMOKE_TIMEOUT"
    target = Path(__file__).resolve().parents[3]/"docs/http-smoke.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    assert report.get("parseMatchesRequest") and report["searchCount"] > 0


if __name__ == "__main__":
    main()
