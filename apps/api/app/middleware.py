"""ASGI-level bounded bodies, public error envelopes, process-local rate/idempotency guards."""
import asyncio
from collections import OrderedDict, deque
import json
import time
from uuid import uuid4

from .jobs import digest
from .errors import AppError


class RequestGuard:
    def __init__(self, app, settings):
        self.app, self.settings = app, settings
        self.rates = OrderedDict()
        self.memo = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        supplied_id = headers.get(b"x-request-id", b"").decode("utf-8", "replace")
        request_id = supplied_id or uuid4().hex
        trace_id = uuid4().hex
        scope.setdefault("state", {}).update(request_id=request_id, trace_id=trace_id)
        key, future, owner = None, None, False
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.request_timeout_seconds

        async def error(exc):
            body = json.dumps({"request_id": request_id, "trace_id": trace_id, "status": "FAILED",
                               "data": None, "errors": [exc.public()]}, ensure_ascii=False).encode()
            await send({"type": "http.response.start", "status": exc.http_status,
                        "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"x-request-id", request_id.encode()),
                                    (b"x-content-type-options", b"nosniff")]})
            await send({"type": "http.response.body", "body": body})
        try:
            if not request_id.isascii() or len(request_id) > 128 or any(ord(c) < 33 for c in request_id):
                request_id = uuid4().hex
                raise AppError("VALIDATION_ERROR", "X-Request-Id 必须是 1–128 位可见 ASCII 字符。")
            if scope["method"] == "POST" and not supplied_id:
                raise AppError("VALIDATION_ERROR", "POST 必须提供 X-Request-Id。", field_path="X-Request-Id")
            clock = time.monotonic()
            # Liveness bypasses rate limits; all paid and polling surfaces remain bounded.
            if scope["method"] != "OPTIONS" and not scope["path"].endswith("/health"):
                ip = (scope.get("client") or ("unknown",))[0]
                bucket = self.rates.setdefault(ip, deque())
                self.rates.move_to_end(ip)
                while bucket and clock-bucket[0] >= 60:
                    bucket.popleft()
                if len(bucket) >= self.settings.rate_limit_per_minute:
                    raise AppError("RATE_LIMITED", "请求过于频繁，请稍后重试。", 429, True)
                bucket.append(clock)
                while len(self.rates) > 4096:
                    self.rates.popitem(last=False)
            body = bytearray()
            if scope["method"] in ("POST", "PUT", "PATCH"):
                content_lengths = [value for name, value in scope.get("headers", []) if name.lower() == b"content-length"]
                transfer_encodings = [value for name, value in scope.get("headers", []) if name.lower() == b"transfer-encoding"]
                declared_length = None
                if len(content_lengths) > 1 or (content_lengths and transfer_encodings):
                    raise AppError("VALIDATION_ERROR", "请求体长度声明冲突。", field_path="Content-Length")
                if content_lengths:
                    raw_length = content_lengths[0]
                    if len(raw_length) > 20 or not raw_length or any(c < 48 or c > 57 for c in raw_length):
                        raise AppError("VALIDATION_ERROR", "Content-Length 必须是非负整数。", field_path="Content-Length")
                    declared_length = int(raw_length)
                    if declared_length > self.settings.max_body_bytes:
                        raise AppError("REQUEST_TOO_LARGE", "请求体超过大小上限。", 413)
                if transfer_encodings and (len(transfer_encodings) != 1 or transfer_encodings[0].lower() != b"chunked"):
                    raise AppError("VALIDATION_ERROR", "不支持的请求体传输编码。")
                chunks = 0
                while True:
                    # The same overall deadline covers body, duplicate wait and
                    # application execution; each chunk cannot reset the timer.
                    message = await asyncio.wait_for(receive(), timeout=max(0, deadline-loop.time()))
                    if message["type"] == "http.disconnect":
                        return
                    if message["type"] != "http.request":
                        raise AppError("VALIDATION_ERROR", "无效的请求体消息。")
                    chunk = message.get("body", b"")
                    chunks += 1
                    if chunks > 8192:
                        raise AppError("REQUEST_TOO_LARGE", "请求体分块数量超过上限。", 413)
                    if len(body) + len(chunk) > self.settings.max_body_bytes:
                        raise AppError("REQUEST_TOO_LARGE", "请求体超过大小上限。", 413)
                    if declared_length is not None and len(body)+len(chunk) > declared_length:
                        raise AppError("VALIDATION_ERROR", "请求体与 Content-Length 不一致。", field_path="Content-Length")
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
                if declared_length is not None and len(body) != declared_length:
                    raise AppError("VALIDATION_ERROR", "请求体与 Content-Length 不一致。", field_path="Content-Length")
            if scope["method"] == "POST":
                try:
                    body_hash = digest(json.loads(body))
                except (ValueError, UnicodeError):
                    raise AppError("VALIDATION_ERROR", "请求体必须为合法 JSON。")
                for expired in [k for k, v in self.memo.items() if v[2].done() and clock-v[0] >= self.settings.job_ttl_seconds]:
                    del self.memo[expired]
                key = (scope["path"], request_id)
                if key in self.memo:
                    _, old_hash, future = self.memo[key]
                    if body_hash != old_hash:
                        raise AppError("REQUEST_ID_CONFLICT", "同一请求 ID 对应不同内容。", 409)
                    response = await asyncio.wait_for(asyncio.shield(future), timeout=max(0, deadline-loop.time()))
                    for message in response:
                        await send(message)
                    return
                if len(self.memo) >= self.settings.max_jobs * 4:
                    raise AppError("RATE_LIMITED", "请求缓存已满，请稍后重试。", 429, True)
                future = asyncio.get_running_loop().create_future()
                self.memo[key] = (clock, body_hash, future)
                owner = True
            delivered, response = False, []
            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()
            async def capture(message):
                if message["type"] == "http.response.start":
                    message = {**message, "headers": list(message.get("headers", [])) + [
                        (b"x-request-id", request_id.encode()), (b"x-content-type-options", b"nosniff"),
                        (b"cache-control", b"no-store")]}
                response.append(message)
            async with asyncio.timeout_at(deadline):
                await self.app(scope, replay, capture)
            if future and owner:
                future.set_result(response)
            for message in response:
                await send(message)
        except TimeoutError:
            await error(AppError("REQUEST_TIMEOUT", "请求超过时限，请重试。", 504, True))
        except AppError as exc:
            await error(exc)
        except asyncio.CancelledError:
            raise
        except Exception:
            await error(AppError("INTERNAL_ERROR", "请求处理失败，请使用 trace_id 排查。", 500))
        finally:
            if owner and future and not future.done():
                # Wake concurrent retries, without holding orphaned futures after disconnect/timeout.
                future.set_result([{"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json")]},
                                   {"type": "http.response.body", "body": json.dumps({"request_id": request_id, "trace_id": trace_id,
                                    "status": "FAILED", "data": None, "errors": [{"code": "API_UNAVAILABLE", "message": "原请求中断，请用新请求ID重试。", "retryable": True}]}).encode()}])
                self.memo.pop(key, None)
