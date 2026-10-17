"""Synthetic upstream protocol fixtures, NOT evidence of successful live calls."""
import asyncio
import json
import logging

import httpx
import pytest

from app.providers import AmapProvider, ProviderError, to_gcj02


def run(coro):
    return asyncio.run(coro)


def test_search_detail_cache_field_facts_and_dedup():
    calls = []
    raw = {"id": "B123", "name": "合成景点", "location": "116.4,39.9", "address": [],
           "biz_ext": {"rating": "4.8", "cost": "200"}}
    def handler(request):
        calls.append(request)
        assert request.url.params["key"] == "test-secret"
        return httpx.Response(200, json={"status": "1", "pois": [raw, raw]})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AmapProvider("test-secret", client=client, cache_authorized=True, cache_ttl_seconds=60)
            places = await provider.search_pois("景点", "北京")
            cached = await provider.search_pois("景点", "北京")
            assert len(places) == 1 and len(calls) == 1
            assert places[0]["ticketPriceCny"]["evidence"]["status"] == "UNKNOWN"
            assert "value" not in places[0]["ticketPriceCny"]
            assert places[0]["rating"]["value"] == 4.8
            assert "address" not in places[0]
            assert "cache hit" in cached[0]["evidence"][0]["note"]
            assert cached[0]["evidence"][0]["fetchedAt"] == places[0]["evidence"][0]["fetchedAt"]
            await provider.poi_detail("B123")
            await provider.poi_detail("B123")
            assert len(calls) == 3  # detail always re-verifies
            assert calls[1].url.path == "/v3/place/detail"
    run(check())


def test_cache_disabled_without_explicit_authorization_and_ttl_expiry():
    async def check():
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={"status": "1", "pois": []})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AmapProvider("k", client=client, cache_ttl_seconds=60)
            await provider.search_pois("a")
            await provider.search_pois("a")
            assert len(calls) == 2
            provider.ttl = .001
            await provider.search_pois("a")
            await asyncio.sleep(.01)
            await provider.search_pois("a")
            assert len(calls) == 4
    run(check())


@pytest.mark.parametrize("mode,path", [("WALK", "walking"), ("DRIVE", "driving")])
def test_road_modes_parse_geometry_seconds_and_distance(mode, path):
    def handler(request):
        assert request.url.path == "/v3/direction/"+path
        assert request.url.params["origin"] == "116.400000,39.900000"
        return httpx.Response(200, json={"status": "1", "route": {"paths": [{"distance": "1200", "duration": "600", "steps": [
            {"polyline": "116.4,39.9;116.41,39.91"}, {"polyline": "116.41,39.91;116.42,39.92"}]}]}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await AmapProvider("k", client=client).routes(POINT, END, mode)
            assert result["durationMin"] == 10
            assert result["distanceMeters"] == 1200
            assert len(result["routeGeometry"]) == 3
            assert result["evidence"]["status"] == "VERIFIED"
    run(check())


POINT = {"lng": 116.4, "lat": 39.9, "coordinateSystem": "GCJ02"}
END = {"lng": 116.42, "lat": 39.92, "coordinateSystem": "GCJ02"}


def test_transit_uses_city_and_native_segment_geometry():
    def handler(request):
        assert request.url.path == "/v3/direction/transit/integrated"
        assert request.url.params["city"] == "北京"
        assert request.url.params["time"] == "08:30"
        return httpx.Response(200, json={"status": "1", "route": {"transits": [{"duration": "1200", "segments": [{
            "walking": {"distance": "100", "steps": [{"polyline": "116.4,39.9;116.41,39.91"}]},
            "bus": {"buslines": [{"distance": "900", "polyline": "116.41,39.91;116.42,39.92"},
                                  {"distance": "9999", "polyline": "116.41,39.91;116.42,39.92"}]}}]}]}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await AmapProvider("k", client=client).routes(POINT, END, "TRANSIT", city="北京", departure_at="2026-10-17T00:30:00Z")
            assert result["distanceMeters"] == 1000
            assert len(result["routeGeometry"]) == 3
            assert result["durationMin"] == 20
    run(check())


def test_incomplete_geometry_does_not_erase_provider_time_or_invent_line():
    def handler(request):
        return httpx.Response(200, json={"status": "1", "route": {"paths": [{"distance": "1", "duration": "1", "steps": []}]}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await AmapProvider("k", client=client).routes(POINT, END, "WALK")
            assert result["evidence"]["status"] == "VERIFIED"
            assert result["durationMin"] == 1/60
            assert "routeGeometry" not in result
    run(check())


def test_nearby_normalizes_wgs84_and_bounds_radius():
    def handler(request):
        assert request.url.path == "/v3/place/around"
        assert request.url.params["location"] != "116.400000,39.900000"
        return httpx.Response(200, json={"status": "1", "pois": []})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AmapProvider("k", client=client)
            assert await provider.nearby_pois({**POINT, "coordinateSystem": "WGS84"}) == []
            with pytest.raises(ProviderError):
                await provider.nearby_pois(POINT, radius_m=50001)
    run(check())


def test_coordinates_are_tagged_finite_and_idempotent():
    converted = to_gcj02({**POINT, "coordinateSystem": "WGS84"})
    assert abs(converted["lng"] - 116.4062428) < .00001
    assert abs(converted["lat"] - 39.9014035) < .00001
    assert to_gcj02(converted) == converted
    for point in ({"lng": 0, "lat": 0}, {**POINT, "lng": float("nan")}, {**POINT, "lat": 100}):
        with pytest.raises(ProviderError):
            to_gcj02(point)


def test_missing_config_and_mismatched_detail_fail_closed():
    async def check():
        with pytest.raises(ProviderError) as err:
            await AmapProvider().search_pois("a")
        assert err.value.http_status == 503
        def handler(request):
            return httpx.Response(200, json={"status": "1", "pois": [{"id": "other", "name": "其他", "location": "116.4,39.9"}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ProviderError) as err:
                await AmapProvider("k", client=client).poi_detail("wanted")
            assert err.value.code == "PLACE_UNVERIFIED"
    run(check())


def test_retry_timeout_and_redacted_errors():
    calls = []
    def handler(request):
        calls.append(request)
        raise httpx.ReadTimeout("raw secret should not escape", request=request)
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ProviderError) as err:
                await AmapProvider("secret", client=client, max_retries=1).search_pois("a")
            assert len(calls) == 2
            assert "secret" not in str(err.value)
    run(check())


@pytest.mark.parametrize("segments", [
    [{"walking": {"distance": "100", "steps": [{"polyline": "116.4,39.9;116.41,39.91"}]},
      "bus": {"buslines": [{"polyline": "116.41,39.91;116.42,39.92"}]}}],
    [{"walking": [], "bus": {"buslines": [{"distance": []}]}}],
])
def test_partial_transit_does_not_claim_partial_sum_as_total(segments):
    def handler(request):
        return httpx.Response(200, json={"status": "1", "route": {"transits": [{"duration": "120", "segments": segments}]}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await AmapProvider("k", client=client).routes(POINT, END, "TRANSIT", "北京")
            assert "distanceMeters" not in result
            assert result["evidence"]["status"] == "UNKNOWN"
    run(check())


def test_disconnected_provider_polylines_not_joined_with_invented_line():
    def handler(request):
        return httpx.Response(200, json={"status": "1", "route": {"paths": [{"distance": "1000", "duration": "100", "steps": [
            {"polyline": "116.4,39.9;116.41,39.91"}, {"polyline": "116.5,40.0;116.51,40.01"}]}]}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await AmapProvider("k", client=client).routes(POINT, END, "WALK")
            assert "routeGeometry" not in result
            assert result["evidence"]["status"] == "VERIFIED"
            assert "geometry incomplete" in result["evidence"]["note"]
    run(check())


def test_httpx_request_log_redacts_query_key(caplog):
    def handler(request):
        return httpx.Response(200, json={"status": "1", "pois": []})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await AmapProvider("sensitive-query-key", client=client).search_pois("a")
    with caplog.at_level(logging.INFO, logger="httpx"):
        run(check())
    assert "sensitive-query-key" not in caplog.text
    assert "[REDACTED]" in caplog.text
