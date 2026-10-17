import asyncio
from types import SimpleNamespace

from app.knowledge import KnowledgeProvider
from test_api import env, generate, post, wait, context  # noqa: F401


def test_guide_uses_background_query_instead_of_cached_ticket_references():
    class Search:
        configured = True
        async def research(self, place, **kwargs):
            assert kwargs == {"city": "北京", "purpose": "KNOWLEDGE"}
            return {"references": [{"title": "景点历史", "snippet": "景点历史介绍", "evidence": {"provider": "synthetic", "status": "ESTIMATED"}}]}
    async def run():
        provider = KnowledgeProvider(search=Search(), wikipedia_enabled=False)
        try:
            result = await provider.lookup({"name": "合成景点", "webResearch": {"references": [{"title": "门票", "snippet": "门票价格"}]}}, city="北京", purpose="KNOWLEDGE")
            assert "景点历史介绍" in result["text"] and "门票价格" not in result["text"]
        finally:
            await provider.aclose()
    asyncio.run(run())


def test_guide_and_document_have_separate_prompts_and_presentation(env):
    client, _, gateway, app = env
    calls = []
    class Knowledge:
        async def lookup(self, place, **kwargs):
            calls.append(kwargs)
            return {"text": "合成景点的山脊与建筑关系，仅供测试。", "evidence": {"provider": "synthetic", "status": "ESTIMATED", "sourceUrl": "https://example.org/history"}}
    app.state.workflows.knowledge = Knowledge()
    original = gateway.generate_structured
    payloads = []
    async def capture(role, schema, payload, **kwargs):
        if schema.__name__ == "ContentDraft":
            payloads.append(payload)
            return SimpleNamespace(data={"title": "景点讲解", "body": "请看城墙沿着山脊延伸，这样的布局与山势相呼应。", "usedEvidenceIndices": [1]}, usage={"provider": "SYNTHETIC_TEST"})
        return await original(role, schema, payload, **kwargs)
    gateway.generate_structured = capture
    plan = generate(client)["data"]["result"]["plan"]
    selected = {"tripId": plan["tripId"], "planRevision": plan["revision"], "mode": plan["mode"], "activeDay": 0, "selectedActivityId": plan["activities"][0]["id"]}
    guide = wait(client, post(client, "/revisions/propose", context(plan, userRequest="讲解这里", selectedContext=selected,
        conversation=[{"role": "assistant", "content": "之前谈到了城墙与山脊。"}])))["data"]["result"]["content"]
    assert guide["deliveryMode"] == "GUIDE" and "https://" not in guide["body"]
    assert guide["evidence"][0]["sourceUrl"] == "https://example.org/history"
    assert calls[0]["purpose"] == "KNOWLEDGE"
    assert "直接向游客口头讲解" in payloads[0]["task"]
    assert "location" not in payloads[0]["place"] and "rating" not in payloads[0]["place"]
    assert payloads[0]["conversation"][0]["content"] == "之前谈到了城墙与山脊。"
    document = wait(client, post(client, "/content/refine", context(plan, userRequest="请创作一份拍摄讲稿", context=selected)))["data"]["result"]["content"]
    assert document["deliveryMode"] == "DOCUMENT" and "参考来源" in document["body"]
    assert calls[-1]["purpose"] == "VISIT"
