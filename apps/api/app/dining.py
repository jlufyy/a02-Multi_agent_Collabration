"""A2 restaurant/source research → A3 real routes → A5 bounds → A7 sourced presentation.

This is part of the product's AgentRunner graph. The coordinator does not call a
single general-purpose model for discovery, navigation or invented review text.
"""
import asyncio
import copy
import re

from .agents import AgentRunner
from .jobs import dump, now_iso
from .providers import ProviderError, to_gcj02
from .proactive import distance
from . import schemas as s


def cuisine_query(preferences):
    words = re.findall(r"火锅|烤鸭|烧烤|川菜|湘菜|湖南菜|粤菜|东北菜|西北菜|清真|素食|面馆|海鲜|日料|寿司|咖啡|早茶|小吃|烤肉", " ".join(preferences))
    return " ".join(dict.fromkeys("湘菜" if w == "湖南菜" else w for w in words))


def audit_candidates(result, req):
    data = copy.deepcopy(dump(result))
    kept = []
    excluded = 0
    for candidate in data["candidates"]:
        route = candidate.get("route") or {}
        if candidate.get("distanceMeters", 0) > req.radiusMeters:
            excluded += 1
            continue
        average = (candidate["place"].get("averageCostCny") or {}).get("value")
        if req.maxAverageCostCny is not None and average is not None and average > req.maxAverageCostCny:
            excluded += 1
            continue
        if route.get("evidence", {}).get("status") == "VERIFIED" and route.get("durationMin") is not None and route["durationMin"] > req.maxWalkMinutes:
            excluded += 1
            continue
        if not route or route.get("durationMin") is None:
            candidate["relevanceReason"] += " 步行路线暂未核验，请先查看位置。"
        kept.append(candidate)
    if excluded:
        data["notes"].append(f"已排除 {excluded} 家超出距离、步行时间或人均参考预算的餐馆。")
    kept.sort(key=lambda c: (not bool(c.get("preferenceMatches")),
        (c.get("route") or {}).get("durationMin") is None,
        -(c["place"].get("rating") or {}).get("value", 0),
        (c.get("route") or {}).get("durationMin") if (c.get("route") or {}).get("durationMin") is not None else 999,
        c.get("distanceMeters", 99999)))
    data["candidates"] = kept[:5]
    data["notes"].append("加入行程前会重新核验交通与时间；推荐不会自动改动正式行程。")
    return data


def format_sources(result):
    data = copy.deepcopy(dump(result))
    for candidate in data["candidates"]:
        research = candidate.get("reviewResearch")
        if research:
            for reference in research["references"]:
                reference["snippet"] = reference["snippet"][:360]
            research["message"] = ("以下为能匹配本店的公开点评或探店资料摘要，可打开原文参考；不是平台完整评论列表。"
                if research["references"] else "暂无能确认属于这家分店的公开评价，未生成虚构点评。")
    return data


async def recommend_food(maps, search, req, job):
    runner = AgentRunner(job)
    query = cuisine_query(req.preferences)
    origin = to_gcj02(dump(req.location))

    async def discover(ctx):
        notes = []
        places = await ctx.tool("nearby_search", maps.nearby_pois, dump(req.location),
            city=req.tripState.destinationCity, query=query, types="050000", radius_m=req.radiusMeters, limit=20)
        matched_query = query
        if query and not places:
            places = await ctx.tool("nearby_search", maps.nearby_pois, dump(req.location),
                city=req.tripState.destinationCity, query="", types="050000", radius_m=req.radiusMeters, limit=20)
            matched_query = ""
            notes.append(f"附近未检索到符合“{query}”的店，以下为其他附近餐馆，可扩大范围或修改口味。")
        candidates = []
        seen = set()
        for place in places:
            if place["poiId"] in seen or place.get("category") != "RESTAURANT":
                continue
            seen.add(place["poiId"])
            meters = distance(origin, to_gcj02(place["location"]))
            if meters > req.radiusMeters:
                continue
            amount = (place.get("averageCostCny") or {}).get("value")
            candidates.append({"place": place, "distanceMeters": round(meters),
                "distanceEvidence": {"provider": "local-haversine", "status": "ESTIMATED", "fetchedAt": now_iso(), "note": "参考点到餐馆的直线距离，不是道路距离"},
                "preferenceMatches": [f"按{matched_query}检索"] if matched_query else [],
                "relevanceReason": f"围绕当前参考点检索的真实餐馆；{'按你的口味筛选' if matched_query else '优先附近可到达的店'}。",
                **({"estimatedCostCny": amount*req.tripState.travelerCount, "costStatus": "ESTIMATED"} if amount is not None else {"costStatus": "UNKNOWN"})})
        candidates.sort(key=lambda c: (-(c["place"].get("rating") or {}).get("value", 0), c["distanceMeters"]))
        return {"candidates": candidates[:6], "anchorLocation": dump(req.location), "searchedRadiusMeters": req.radiusMeters, "notes": notes}

    found = await runner.run("A2", req, s.NearbySearchResult, discover)

    async def route(ctx):
        data = dump(found)
        semaphore = asyncio.Semaphore(3)
        async def one(candidate):
            async with semaphore:
                try:
                    candidate["route"] = await ctx.tool("route_query", maps.routes, dump(req.location), candidate["place"]["location"], "WALK", city=req.tripState.destinationCity)
                except ProviderError:
                    candidate["route"] = {"mode": "WALK", "evidence": {"provider": "amap", "status": "UNKNOWN", "fetchedAt": now_iso(), "note": "未取得可核验的步行路线"}}
        await asyncio.gather(*(one(c) for c in data["candidates"]))
        return data
    routed = await runner.run("A3", found, s.NearbySearchResult, route)

    async def audit(ctx):
        return await ctx.tool("dining_audit", audit_candidates, routed, req)
    audited = await runner.run("A5", routed, s.NearbySearchResult, audit)

    async def research(ctx):
        data = dump(audited)
        if req.includeReviews:
            async def one(candidate):
                if search and search.configured:
                    candidate["reviewResearch"] = await ctx.tool("knowledge_search", search.research, candidate["place"], city=req.tripState.destinationCity, purpose="FOOD")
                else:
                    candidate["reviewResearch"] = {"status": "NOT_CONFIGURED", "query": "", "checkedAt": now_iso(), "references": [], "message": "暂无联网评价来源。"}
            await asyncio.gather(*(one(c) for c in data["candidates"]))
        return data
    researched = await runner.run("A2", audited, s.NearbySearchResult, research)

    async def present(ctx):
        return await ctx.tool("format_dining_sources", format_sources, researched)
    result = await runner.run("A7", researched, s.NearbySearchResult, present)
    partial = len(result.candidates) < 2
    if partial:
        job.errors.append({"code": "INSUFFICIENT_CANDIDATES", "message": "当前范围内符合条件的餐馆不足两家，可以扩大范围或放宽口味。", "retryable": False})
    return result, partial
