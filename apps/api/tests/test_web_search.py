"""Search request contracts, honest evidence and workflow degradation with synthetic responses."""
import asyncio
import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import schemas as s
from app.config import Settings
from app.jobs import dump
from app.knowledge import KnowledgeProvider
from app.main import create_app
from app.web_search import WebSearchProvider, public_url
from test_api import SyntheticMaps, SyntheticGateway, generate, post, wait, context
from test_planning import poi


@pytest.mark.parametrize("provider", ["tavily", "bocha", "tencent_wsa"])
def test_search_request_and_safe_relevant_references(provider):
    async def run():
        place = poi()
        rows = [
            {"title": place["name"] + "游览公告", "name": place["name"] + "游览公告",
             "url": "https://example.org/notice", "content": "测试摘要：需要预约。", "summary": "测试摘要：需要预约。"},
            {"title": "其他景点", "url": "https://example.org/unrelated", "content": "没有匹配地点"},
            {"title": place["name"], "url": "javascript:alert(1)", "content": place["name"]},
            {"title": place["name"], "url": "http://127.0.0.1/private", "content": place["name"]},
        ]
        def handle(request):
            assert request.headers["Authorization"] == "Bearer synthetic-secret"
            data = json.loads(request.content)
            query = data.get("Query") or data.get("query")
            assert place["name"] in query and "2026-10-20" in query
            assert "private conversation" not in request.content.decode()
            if provider == "tavily":
                assert request.url.path == "/search" and data["include_answer"] is False
                return httpx.Response(200, json={"results": rows})
            if provider == "tencent_wsa":
                assert request.url.path == "/SearchPro" and list(data) == ["Query"]
                return httpx.Response(200, json={"Response": {"Pages": ["broken row"] + [json.dumps(row) for row in rows]}})
            assert request.url.path == "/v1/web-search" and data["summary"] is True
            return httpx.Response(200, json={"code": 200, "data": {"webPages": {"value": rows}}})
        original = copy.deepcopy(place)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            search = WebSearchProvider(provider, "synthetic-secret", client=client)
            result = s.WebResearch.model_validate(await search.research(place, city="北京", visit_date="2026-10-20"))
            assert result.status == "AVAILABLE" and len(result.references) == 1
            assert result.references[0].evidence.status == "ESTIMATED"
            assert "synthetic-secret" not in json.dumps(dump(result))
            assert place == original  # Never mutate opening/ticket/booking facts from a snippet.
            knowledge = KnowledgeProvider(client, search=search, wikipedia_enabled=False)
            reference = await knowledge.lookup({**place, "webResearch": dump(result)})
            assert reference["evidence"]["sourceUrl"] == "https://example.org/notice"
    asyncio.run(run())


@pytest.mark.parametrize("code, message", [
    ("UnauthorizedOperation", "授权"), ("ResourceNotFound", "尚未开通"),
    ("ResourceUnavailable", "额度"), ("RequestLimitExceeded", "请求较多"), ("InternalError", "暂时无法获取"),
])
def test_tencent_business_errors_are_not_mistaken_for_empty_success(code, message):
    async def run():
        body = {"Response": {"Error": {"Code": code, "Message": "synthetic-secret upstream details"}}}
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))) as client:
            result = await WebSearchProvider("tencent_wsa", "secret", client=client).research(poi())
            assert result["status"] == "UNAVAILABLE" and message in result["message"]
            assert "synthetic-secret" not in json.dumps(result)
    asyncio.run(run())


def test_tencent_passage_json_and_configured_full_endpoint(monkeypatch):
    monkeypatch.setenv("TRIPFLOW_SEARCH_PROVIDER", "tencent_wsa")
    monkeypatch.setenv("TENCENTCLOUD_WSA_APIKEY", "synthetic-secret")
    monkeypatch.setenv("TENCENTCLOUD_WSA_API_URL", "https://api.wsa.cloud.tencent.com/SearchPro")
    settings = Settings.from_env()
    assert settings.search_api_key == "synthetic-secret" and settings.search_provider == "tencent_wsa"
    async def run():
        place = poi()
        def handle(request):
            assert request.url.path == "/SearchPro"
            page = {"title": "<strong>" + place["name"] + "</strong>公告", "url": "https://example.org/notice", "passage": "<strong>预约</strong>&amp;公告"}
            return httpx.Response(200, json={"Response": {"Pages": [json.dumps(page)]}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            result = await WebSearchProvider(settings.search_provider, settings.search_api_key, settings.search_base_url, client).research(place)
            assert result["status"] == "AVAILABLE" and result["references"][0]["snippet"] == "预约&公告"
    asyncio.run(run())


@pytest.mark.parametrize("response", [
    httpx.Response(401, text="synthetic-secret private failure"), httpx.Response(429),
    httpx.Response(500), httpx.Response(200, text="not json"), httpx.Response(200, json=[]),
    httpx.Response(200, json={"results": "bad rows"}), httpx.Response(200, content=b"x" * 1_000_001),
])
def test_search_failure_degrades_without_exposing_upstream_body(response):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: response)) as client:
            search = WebSearchProvider("tavily", "synthetic-secret", client=client)
            data = await search.research(poi())
            assert data["status"] == "UNAVAILABLE" and data["references"] == []
            assert "synthetic-secret" not in json.dumps(data)
    asyncio.run(run())


def test_timeout_and_empty_results_are_distinct_from_missing_configuration():
    async def run():
        async def handle(request):
            raise httpx.ReadTimeout("synthetic-secret", request=request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            assert (await WebSearchProvider(client=client).research(poi()))["status"] == "NOT_CONFIGURED"
            assert (await WebSearchProvider("tavily", "secret", client=client).research(poi()))["status"] == "UNAVAILABLE"
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"results": []}))) as client:
            assert (await WebSearchProvider("tavily", "secret", client=client).research(poi()))["status"] == "EMPTY"
    asyncio.run(run())


def test_qualified_poi_name_requires_city_when_only_short_name_matches():
    async def run():
        place = poi()
        place["name"] = "杭州西湖风景名胜区-太子湾公园"
        rows = [{"title": "杭州太子湾公园游览提示", "url": "https://example.org/match", "content": "开放公告"},
                {"title": "太子湾公园", "url": "https://example.org/ambiguous", "content": "没有城市信息"}]
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"results": rows}))) as client:
            search = WebSearchProvider("tavily", "secret", base_url="https://api.tavily.com/search", client=client)
            result = await search.research(place, city="杭州")
            assert [r["url"] for r in result["references"]] == ["https://example.org/match"]
            assert result["references"][0]["evidence"]["status"] == "ESTIMATED"
    asyncio.run(run())


@pytest.mark.parametrize("url", ["javascript:alert(1)", "file:///etc/passwd", "http://localhost/x", "http://169.254.169.254/", "http://[::1]/", "https://user:***@search.invalid/", "http://10.0.0.1/", "https://service.local/x"])
def test_search_rejects_unsafe_source_links(url):
    assert not public_url(url)


def test_search_integrates_generation_content_and_final_review():
    class SyntheticSearch:
        configured = True
        def __init__(self):
            self.calls = []
        async def aclose(self):
            pass
        async def research(self, place, **kwargs):
            self.calls.append((place["poiId"], kwargs))
            return {"status": "AVAILABLE", "query": place["name"], "checkedAt": "2026-10-17T00:00:00Z",
                    "references": [{"title": place["name"] + "测试来源", "url": "https://example.org/notice",
                        "snippet": "测试资料，不是真实政策。", "evidence": {"provider": "synthetic-search", "status": "ESTIMATED", "sourceUrl": "https://example.org/notice"}}],
                    "message": "已找到相关资料，请核对。"}
    search = SyntheticSearch()
    settings = Settings(rate_limit_per_minute=10000)
    with TestClient(create_app(settings, SyntheticMaps(), SyntheticGateway(), search)) as client:
        result = generate(client, intents=True)["data"]["result"]
        plan = result["plan"]
        assert search.calls and all(a["place"]["webResearch"]["references"] for a in plan["activities"])
        count = len(search.calls)
        assert count == len({a["place"]["poiId"] for a in plan["activities"]})
        # A7 reuses source-backed plan search; no duplicate external query for the same POI.
        assert result["preparedContents"] and count <= 12
        single = post(client, "/places/research", {"executionMode": "REAL", "poiId": plan["activities"][0]["place"]["poiId"], "city": "北京", "visitDate": "2026-10-20"})
        assert s.ApiResponse[s.WebResearch].model_validate(single.json()).data.status == "AVAILABLE"
        proposal = wait(client, post(client, "/revisions/propose", context(plan, operations=[
            {"type": "UPDATE_DURATION", "activityId": plan["activities"][0]["id"], "durationMin": 40}])))["data"]["result"]["proposal"]
        reviewed = wait(client, post(client, "/revisions/validate", context(plan, proposal=proposal)))["data"]["result"]["validation"]
        assert reviewed["committable"], reviewed
        assert not any(x.startswith("REPROPOSE_REQUIRED") for x in reviewed["unknownChecks"])


def test_search_configuration_and_capabilities_do_not_leak_keys(monkeypatch):
    monkeypatch.setenv("TRIPFLOW_SEARCH_PROVIDER", "tavily")
    monkeypatch.setenv("TAVILY_API_KEY", "synthetic-secret")
    settings = Settings.from_env()
    assert settings.search_provider == "tavily" and settings.search_api_key == "synthetic-secret"
    assert "synthetic-secret" not in repr(settings)
    with TestClient(create_app(settings, SyntheticMaps(), SyntheticGateway())) as client:
        caps = client.get("/api/v1/capabilities")
        assert "synthetic-secret" not in caps.text
        assert next(t for t in caps.json()["data"]["tools"] if t["name"] == "web_search")["available"]
