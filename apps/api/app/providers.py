"""Server-only Amap Web Service adapter. Never fabricate missing facts or roads."""
from __future__ import annotations

import asyncio
import copy
import logging
import math
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, quote_plus

import httpx


class _SecretFilter(logging.Filter):
    """httpx INFO normally logs the request URL including Amap's query key."""
    def __init__(self, secret: str):
        super().__init__()
        self._variants = {secret, quote(secret, safe=""), quote_plus(secret)} - {""}

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for value in self._variants:
            message = message.replace(value, "[REDACTED]")
        record.msg, record.args = message, ()
        return True


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False, http_status: int = 502):
        super().__init__(message)
        self.code, self.message = code, message
        self.retryable, self.http_status = retryable, http_status


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_gcj02(point: Any) -> dict:
    """Convert tagged WGS84 once; existing GCJ02 is never shifted again.

    Formula is the common approximate civilian transform, not survey-grade.
    Outside mainland bounding rectangle the input remains unchanged numerically.
    """
    if hasattr(point, "model_dump"):
        point = point.model_dump()
    if not isinstance(point, dict):
        raise ProviderError("VALIDATION_ERROR", "坐标必须包含经纬度和坐标体系", http_status=422)
    try:
        lng, lat = float(point["lng"]), float(point["lat"])
    except (KeyError, ValueError, TypeError):
        raise ProviderError("VALIDATION_ERROR", "无效经纬度", http_status=422) from None
    if not math.isfinite(lng) or not math.isfinite(lat) or not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise ProviderError("VALIDATION_ERROR", "经纬度超出范围", http_status=422)
    system = point.get("coordinateSystem")
    if system not in {"WGS84", "GCJ02"}:
        raise ProviderError("VALIDATION_ERROR", "缺少或不支持的坐标体系", http_status=422)
    if system == "WGS84" and 72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271:
        x, y = lng - 105, lat - 35
        dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*math.sqrt(abs(x))
        dlat += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
        dlat += (20*math.sin(y*math.pi)+40*math.sin(y*math.pi/3))*2/3
        dlat += (160*math.sin(y*math.pi/12)+320*math.sin(y*math.pi/30))*2/3
        dlng = 300 + x + 2*y + .1*x*x + .1*x*y + .1*math.sqrt(abs(x))
        dlng += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
        dlng += (20*math.sin(x*math.pi)+40*math.sin(x*math.pi/3))*2/3
        dlng += (150*math.sin(x*math.pi/12)+300*math.sin(x*math.pi/30))*2/3
        rad = lat / 180 * math.pi
        magic = 1 - .00669342162296594323 * math.sin(rad)**2
        dlat = dlat*180/((6378245*(1-.00669342162296594323))/(magic*math.sqrt(magic))*math.pi)
        dlng = dlng*180/(6378245/math.sqrt(magic)*math.cos(rad)*math.pi)
        lng, lat = lng + dlng, lat + dlat
    return {"lng": lng, "lat": lat, "coordinateSystem": "GCJ02"}


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) and parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def _point(value: Any) -> dict | None:
    if not isinstance(value, str):
        return None
    try:
        lng, lat = value.split(",")
        return to_gcj02({"lng": lng, "lat": lat, "coordinateSystem": "GCJ02"})
    except (ValueError, ProviderError):
        return None


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _items(value: Any) -> list:
    return value if isinstance(value, list) else []


def _gap_meters(first: dict, second: dict) -> float:
    latitude1, latitude2 = math.radians(first["lat"]), math.radians(second["lat"])
    dlat = latitude2-latitude1
    dlng = math.radians(second["lng"]-first["lng"])
    h = math.sin(dlat/2)**2 + math.cos(latitude1)*math.cos(latitude2)*math.sin(dlng/2)**2
    return 2*6371000*math.asin(min(1, math.sqrt(h)))


class AmapProvider:
    def __init__(self, api_key: str = "", *, client: httpx.AsyncClient | None = None,
                 timeout_seconds: float = 8, max_retries: int = 2,
                 cache_ttl_seconds: float = 0, cache_max_entries: int = 512,
                 cache_authorized: bool = False):
        self._key = api_key
        if api_key:
            logging.getLogger("httpx").addFilter(_SecretFilter(api_key))
        self._client = client or httpx.AsyncClient(follow_redirects=False, trust_env=False)
        self._owns_client = client is None
        self.timeout = timeout_seconds
        self.retries = max(0, min(max_retries, 3))
        self.ttl = max(0, cache_ttl_seconds) if cache_authorized else 0
        self.cache_size = max(1, cache_max_entries)
        self._cache: OrderedDict[tuple, tuple[float, dict, str]] = OrderedDict()

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def aclose(self):
        if self._owns_client:
            await self._client.aclose()

    async def _get(self, path: str, params: dict, *, fresh: bool = False) -> tuple[dict, str, str]:
        if not self.configured:
            raise ProviderError("API_UNAVAILABLE", "高德 Web Service Key 尚未配置", http_status=503)
        cache_key = (path, tuple(sorted(params.items())))
        entry = self._cache.get(cache_key)
        now = time.monotonic()
        if not fresh and entry and entry[0] > now:
            self._cache.move_to_end(cache_key)
            return copy.deepcopy(entry[1]), entry[2], "TTL cache hit; original fetchedAt retained; not real-time"
        if entry:
            del self._cache[cache_key]
        for attempt in range(self.retries + 1):
            try:
                response = await self._client.get("https://restapi.amap.com" + path,
                    params={**params, "key": self._key, "output": "JSON"}, timeout=self.timeout)
                if response.status_code != 200:
                    transient = response.status_code in {408, 429} or response.status_code >= 500
                    raise ProviderError("API_UNAVAILABLE", "高德服务暂不可用", transient)
                if len(response.content) > 5_000_000:
                    raise ProviderError("API_UNAVAILABLE", "高德响应超出大小限制")
                try:
                    data = response.json()
                except ValueError:
                    raise ProviderError("API_UNAVAILABLE", "高德返回无效 JSON") from None
                if not isinstance(data, dict):
                    raise ProviderError("API_UNAVAILABLE", "高德返回格式不合法")
                if str(data.get("status")) != "1":
                    code = str(data.get("infocode", ""))
                    transient = code in {"10003", "10016", "10020", "10021"}
                    raise ProviderError("API_UNAVAILABLE", "高德请求失败，请检查授权、配额和参数", transient)
                fetched = utc_now()
                if self.ttl:
                    self._cache[cache_key] = (time.monotonic()+self.ttl, copy.deepcopy(data), fetched)
                    while len(self._cache) > self.cache_size:
                        self._cache.popitem(last=False)
                return data, fetched, "fresh upstream response; not a live inventory guarantee"
            except httpx.TimeoutException:
                error = ProviderError("API_UNAVAILABLE", "高德请求超时", True, 504)
            except httpx.RequestError:
                error = ProviderError("API_UNAVAILABLE", "高德网络请求失败", True)
            except ProviderError as exc:
                error = exc
            if not error.retryable or attempt >= self.retries:
                raise error from None
            await asyncio.sleep(min(.15 * 2**attempt, 1))
        raise AssertionError("unreachable")

    @staticmethod
    def _evidence(external_id: str, fetched: str, note: str, status: str = "VERIFIED") -> dict:
        return {"provider": "amap", "externalId": external_id, "fetchedAt": fetched,
                "status": status, "sourceUrl": "https://lbs.amap.com/api/webservice/guide/api-advanced/search", "note": note}

    def _place(self, raw: dict, fetched: str, cache_note: str) -> dict | None:
        point = _point(raw.get("location"))
        if not raw.get("id") or not isinstance(raw.get("name"), str) or not raw["name"] or not point:
            return None
        pid = str(raw["id"])
        evidence = self._evidence(pid, fetched, "Fields: poiId/name/location/address only; " + cache_note)
        place = {"poiId": pid, "name": raw["name"], "location": point, "evidence": [evidence]}
        if isinstance(raw.get("address"), str) and raw["address"]:
            place["address"] = raw["address"]
        unknown = "Provider endpoint does not establish this field; not zero/free/open"
        for field in ("openingHours", "ticketPriceCny", "queueMinutes", "bookingNote"):
            place[field] = {"evidence": self._evidence(pid, fetched, f"Field: {field}; {unknown}; {cache_note}", "UNKNOWN")}
        rating = _number((raw.get("biz_ext") or {}).get("rating")) if isinstance(raw.get("biz_ext"), dict) else None
        place["rating"] = {"evidence": self._evidence(pid, fetched, "Field: rating; provider-supplied rating; " + cache_note,
                                                     "VERIFIED" if rating is not None else "UNKNOWN")}
        if rating is not None:
            place["rating"]["value"] = rating
        # biz_ext.cost is average spending, NOT an admission ticket or group cost.
        return place

    def _places(self, data: dict, fetched: str, note: str) -> list[dict]:
        seen, result = set(), []
        for raw in data.get("pois", []) if isinstance(data.get("pois"), list) else []:
            if isinstance(raw, dict):
                place = self._place(raw, fetched, note)
                if place and place["poiId"] not in seen:
                    seen.add(place["poiId"])
                    result.append(place)
        return result

    async def search_pois(self, query: str, city: str | None = None, location: Any = None,
                          radius_m: int = 3000, limit: int = 20, types: str | None = None) -> list[dict]:
        if not query.strip():
            raise ProviderError("VALIDATION_ERROR", "搜索词不能为空", http_status=422)
        if location is not None:
            return await self.nearby_pois(location, radius_m=radius_m, query=query, city=city, limit=limit)
        params = {"keywords": query, "offset": max(1, min(limit, 25)), "page": 1, "extensions": "all"}
        if types:
            params["types"] = types
        if city:
            params.update(city=city, citylimit="true")
        return self._places(*(await self._get("/v3/place/text", params)))

    async def poi_detail(self, poi_id: str) -> dict:
        if not poi_id or len(poi_id) > 128:
            raise ProviderError("VALIDATION_ERROR", "无效 POI ID", http_status=422)
        # Re-verification explicitly bypasses cache and trusts the returned ID only.
        places = self._places(*(await self._get("/v3/place/detail", {"id": poi_id, "extensions": "all"}, fresh=True)))
        for place in places:
            if place["poiId"] == poi_id:
                return place
        raise ProviderError("PLACE_UNVERIFIED", "未能按 ID 核验该地点，不能绑定其他候选", http_status=422)

    async def nearby_pois(self, location: Any, radius_m: int = 3000, query: str = "",
                          city: str | None = None, limit: int = 5) -> list[dict]:
        point = to_gcj02(location)
        if not 0 <= radius_m <= 50000:
            raise ProviderError("VALIDATION_ERROR", "周边半径需在 0–50000 米", http_status=422)
        params = {"location": f"{point['lng']:.6f},{point['lat']:.6f}", "radius": radius_m,
                  "offset": max(1, min(limit, 25)), "page": 1, "extensions": "all", "sortrule": "distance"}
        if query:
            params["keywords"] = query
        if city:
            params["city"] = city
        return self._places(*(await self._get("/v3/place/around", params)))

    async def routes(self, origin: Any, destination: Any, mode: str, city: str | None = None,
                     destination_city: str | None = None, departure_at: str | None = None) -> dict:
        mode = getattr(mode, "value", mode)
        paths = {"WALK": "walking", "DRIVE": "driving", "TRANSIT": "transit/integrated"}
        if mode not in paths:
            raise ProviderError("VALIDATION_ERROR", "不支持的交通模式", http_status=422)
        start, end = to_gcj02(origin), to_gcj02(destination)
        params = {"origin": f"{start['lng']:.6f},{start['lat']:.6f}",
                  "destination": f"{end['lng']:.6f},{end['lat']:.6f}"}
        if mode == "TRANSIT":
            if not city:
                raise ProviderError("VALIDATION_ERROR", "公交路线必须指定城市", http_status=422)
            params.update(city=city, extensions="all", strategy=0)
            if destination_city:
                params["cityd"] = destination_city
            if departure_at:
                try:
                    departure = datetime.fromisoformat(departure_at.replace("Z", "+00:00"))
                    if departure.tzinfo is None:
                        raise ValueError()
                    from datetime import timedelta
                    departure = departure.astimezone(timezone(timedelta(hours=8)))
                    params.update(date=departure.strftime("%Y-%m-%d"), time=departure.strftime("%H:%M"))
                except ValueError:
                    raise ProviderError("VALIDATION_ERROR", "出发时间必须包含时区", http_status=422) from None
        data, fetched, cache_note = await self._get("/v3/direction/"+paths[mode], params)
        route = data.get("route") if isinstance(data.get("route"), dict) else {}
        choices = route.get("transits" if mode == "TRANSIT" else "paths", [])
        ev = {"provider": "amap", "fetchedAt": fetched,
              "sourceUrl": "https://lbs.amap.com/api/webservice/guide/api/direction",
              "status": "UNKNOWN", "note": cache_note}
        result = {"mode": mode, "evidence": ev}
        if not choices or not isinstance(choices, list) or not isinstance(choices[0], dict):
            ev["note"] += "; no route returned; no straight-line fallback"
            return result
        choice = choices[0]
        distance, duration = _number(choice.get("distance")), _number(choice.get("duration"))
        polylines: list[str] = []
        complete_geometry = True
        if mode == "TRANSIT":
            component_distances: list[float] = []
            distance_complete = True
            segments = _items(choice.get("segments"))
            if not segments:
                complete_geometry = False
                distance_complete = False
            for segment in segments:
                if not isinstance(segment, dict):
                    complete_geometry = distance_complete = False
                    continue
                walking = _mapping(segment.get("walking"))
                wd = _number(walking.get("distance"))
                if wd is not None:
                    component_distances.append(wd)
                elif walking:
                    distance_complete = False
                steps = _items(walking.get("steps"))
                for step in steps:
                    polylines.append(_mapping(step).get("polyline", ""))
                if wd and not steps:
                    complete_geometry = False
                lines = _items(_mapping(segment.get("bus")).get("buslines"))
                # buslines are alternative services for the same segment; choose one.
                if lines:
                    line = _mapping(lines[0])
                    ld = _number(line.get("distance"))
                    if ld is not None:
                        component_distances.append(ld)
                    else:
                        distance_complete = False
                    polylines.append(line.get("polyline", ""))
                if segment.get("railway"):
                    complete_geometry = False  # rail endpoint pairs are not actual geometry
                    rd = _number(_mapping(segment["railway"]).get("distance"))
                    if rd is not None:
                        component_distances.append(rd)
                    else:
                        distance_complete = False
                if segment.get("taxi"):
                    # The native transit taxi object has no road polyline here.
                    complete_geometry = distance_complete = False
            if distance is None and distance_complete and component_distances:
                distance = sum(component_distances)
        else:
            polylines = [_mapping(s).get("polyline", "") for s in _items(choice.get("steps"))]
        geometry: list[dict] = []
        for polyline in polylines:
            if not isinstance(polyline, str) or not polyline:
                complete_geometry = False
                continue
            for index, token in enumerate(polyline.split(";")):
                point = _point(token)
                if point is None:
                    complete_geometry = False
                    continue
                if index == 0 and geometry and _gap_meters(geometry[-1], point) > 30:
                    complete_geometry = False
                if not geometry or geometry[-1] != point:
                    geometry.append(point)
        if duration is not None:
            result["durationMin"] = duration / 60
        if distance is not None:
            result["distanceMeters"] = distance
        if complete_geometry and len(geometry) >= 2:
            result["routeGeometry"] = geometry
        # Evidence verifies the returned travel estimate, not missing optional geometry.
        # Geometry remains omitted and independently listed as unknown by A5.
        ev["status"] = "VERIFIED" if duration is not None and distance is not None else "UNKNOWN"
        ev["note"] += "; provider-estimated travel time (not observed); " + (
            "full supplied road geometry" if result.get("routeGeometry") else "geometry incomplete; omitted to avoid invented connecting lines")
        return result
