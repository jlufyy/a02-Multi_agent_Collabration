import asyncio
import httpx
from app.knowledge import KnowledgeProvider
from test_planning import poi


def test_knowledge_requires_matching_title_coordinates_and_safe_source():
    async def run():
        place = poi()
        page = {"title": place["name"], "pageid": 1, "extract": "合成知识，非真实资料。",
                "coordinates": [{"lat": 39.9, "lon": 116.4, "globe": "earth"}], "fullurl": "https://zh.wikipedia.org/wiki/test"}
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"query": {"pages": [page]}}))) as client:
            provider = KnowledgeProvider(client)
            assert (await provider.lookup(place))["evidence"]["provider"] == "wikipedia"
            page["title"] = "另一个同名附近商店"
            assert await provider.lookup(place) is None
            page["title"] = place["name"]
            page["coordinates"][0]["lat"] = 20
            assert await provider.lookup(place) is None
            page["coordinates"][0]["lat"] = 39.9
            page["fullurl"] = "https://untrusted.invalid"
            assert await provider.lookup(place) is None
    asyncio.run(run())
