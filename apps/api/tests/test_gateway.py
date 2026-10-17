"""Synthetic native-protocol adapter tests; live two-vendor acceptance BLOCKED."""
import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel, ConfigDict

from app.gateway import ModelGateway
from app.providers import ProviderError


class Output(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: str
    days: int


def config(kind="openai-compatible", **changes):
    return {"kind": kind, "base_url": "https://vendor.test/v1", "api_key": "test-secret", "model": "requested-model", **changes}


def openai_response(content='{"city":"北京","days":2}', **changes):
    return {"model": "actual-model", "choices": [{"finish_reason": "stop", "message": {"content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20}, **changes}


def run(coro):
    return asyncio.run(coro)


def test_openai_protocol_schema_validation_and_actual_usage():
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-secret"
        assert body["response_format"] == {"type": "json_object"}
        assert body["messages"][0]["role"] == "system"
        assert "untrusted" in body["messages"][0]["content"]
        assert "tools" not in body
        return httpx.Response(200, json=openai_response())
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config(input_cost_per_million=1, output_cost_per_million=2)}, {"A1": "p"}, client=client)
            result = await gateway.generate_structured("A1", Output, {"text": "北京两日"}, job_id="j")
            assert result.data == {"city": "北京", "days": 2}
            assert result.usage["provider"] == "p" and result.usage["model"] == "actual-model"
            assert result.usage["estimatedCostCny"] == .00005
            assert result.usage["repairAttempts"] == 0
    run(check())


def test_deepseek_a1_keeps_the_json_budget_without_changing_other_roles_or_hosts():
    from app.gateway import ProviderConfig
    gateway = ModelGateway()
    direct = ProviderConfig(**config(base_url="https://api.deepseek.com", a1_thinking_mode="disabled"))
    assert gateway._body("A1", direct, {}, {"type": "object"}, False)[1]["thinking"] == {"type": "disabled"}
    assert "thinking" not in gateway._body("A7", direct, {}, {"type": "object"}, False)[1]
    proxy = ProviderConfig(**config(a1_thinking_mode="disabled"))
    assert "thinking" not in gateway._body("A1", proxy, {}, {"type": "object"}, False)[1]
    run(gateway.aclose())


def test_native_anthropic_forced_tool_and_text_role_route():
    calls = []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert request.url.path == "/v1/messages"
        assert request.headers["x-api-key"] == "test-secret"
        assert request.headers["anthropic-version"] == "2023-06-01"
        assert "response_format" not in body
        assert "system" in body and body["messages"][0]["role"] == "user"
        content = ([{"type": "tool_use", "name": "emit_structured", "input": {"city": "上海", "days": 1}}]
                   if "tools" in body else [{"type": "text", "text": "Hello"}])
        return httpx.Response(200, json={"model": "claude-actual", "stop_reason": "tool_use" if "tools" in body else "end_turn", "content": content,
            "usage": {"input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 3, "cache_read_input_tokens": 4}})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"second": config("anthropic")}, {"A7": {"provider": "second", "model": "role-model"}}, client=client)
            result = await gateway.generate_structured("A7", Output, {}, job_id="j")
            assert result.data["city"] == "上海"
            assert calls[0]["tools"][0]["input_schema"]["required"] == ["city", "days"]
            assert calls[0]["tool_choice"]["name"] == "emit_structured"
            assert result.usage["inputTokens"] == 17
            assert calls[0]["model"] == "role-model"
            result = await gateway.generate_text("A7", {}, job_id="j")
            assert result.data == "Hello"
    run(check())


def test_schema_failure_gets_exactly_one_repair():
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=openai_response('{"city":"北京"}' if len(calls) == 1 else '{"city":"北京","days":2}'))
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A1": "p"}, client=client)
            result = await gateway.generate_structured("A1", Output, {}, "j")
            assert result.usage["repairAttempts"] == 1 and len(calls) == 2
            assert "single repair" in calls[1]["messages"][0]["content"]
            assert len(result.usage["calls"]) == 2
    run(check())


@pytest.mark.parametrize("content", ["not JSON", '{"city":"北京"}'])
def test_invalid_output_is_visible_after_one_repair(content):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=openai_response(content))
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A1": "p"}, client=client)
            with pytest.raises(ProviderError) as err:
                await gateway.generate_structured("A1", Output, {}, "j")
            assert err.value.code == "INVALID_MODEL_OUTPUT" and len(calls) == 2
    run(check())


def test_retry_uses_job_call_budget_and_never_exposes_raw_error():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(429, json={"error": "test-secret"})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A1": "p"}, client=client, max_calls_per_job=1)
            with pytest.raises(ProviderError) as err:
                await gateway.generate_text("A1", {}, "j")
            assert err.value.code == "BUDGET_LIMIT" and len(calls) == 1
            assert "secret" not in str(err.value)
    run(check())


def test_daily_reserve_is_atomic_across_concurrent_jobs():
    calls = []
    async def handler(request):
        calls.append(request)
        await asyncio.sleep(.02)
        return httpx.Response(200, json=openai_response("Hello"))
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A7": "p"}, client=client, daily_budget_cny=1, reservation_cny=1)
            results = await asyncio.gather(gateway.generate_text("A7", {}, "j1"), gateway.generate_text("A7", {}, "j2"), return_exceptions=True)
            assert len(calls) == 1
            assert sum(isinstance(r, ProviderError) and r.code == "BUDGET_LIMIT" for r in results) == 1
    run(check())


def test_missing_route_or_key_is_blocked_without_http():
    async def check():
        gateway = ModelGateway({"p": config(api_key="")}, {"A1": "p"})
        try:
            with pytest.raises(ProviderError) as err:
                await gateway.generate_text("A1", {})
            assert err.value.http_status == 503
            with pytest.raises(ProviderError):
                await gateway.generate_text("A2", {})
        finally:
            await gateway.aclose()
    run(check())


def test_timeout_retries_bounded_and_safe():
    calls = []
    def handler(request):
        calls.append(request)
        raise httpx.ReadTimeout("test-secret", request=request)
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A1": "p"}, client=client, max_retries=1)
            with pytest.raises(ProviderError) as err:
                await gateway.generate_text("A1", {}, "j")
            assert err.value.code == "LLM_TIMEOUT" and len(calls) == 2
            assert "secret" not in str(err.value)
    run(check())


def test_jsonschema_dict_is_actually_validated():
    def handler(request):
        return httpx.Response(200, json=openai_response('{"x":"bad"}'))
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = ModelGateway({"p": config()}, {"A1": "p"}, client=client)
            with pytest.raises(ProviderError):
                await gateway.generate_structured("A1", {"type": "object", "required": ["x"], "properties": {"x": {"type": "number"}}}, {}, "j")
    run(check())
