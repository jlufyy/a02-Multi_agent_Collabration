"""Bounded search adapters. Search snippets are references, never verified POI facts."""
import asyncio
import ipaddress
import json
import html
import re
from urllib.parse import urlsplit

import httpx

from .jobs import now_iso


def public_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        return False
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        if url.scheme not in ("https", "http") or url.username or url.password or not host or url.port not in (None, 80, 443):
            return False
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


def compact(text):
    return re.sub(r"[\W_]+", "", text).casefold()


class WebSearchProvider:
    def __init__(self, provider="", api_key="", base_url="", client=None, timeout_seconds=8):
        self.provider, self.api_key = provider, api_key
        defaults = {"tavily": "https://api.tavily.com", "bocha": "https://api.bochaai.com",
                    "tencent_wsa": "https://api.wsa.cloud.tencent.com"}
        self.base_url = (base_url or defaults.get(provider, "")).rstrip("/")
        if self.base_url and (urlsplit(self.base_url).scheme != "https" or not public_url(self.base_url)):
            raise ValueError("Search endpoint must use a public HTTPS URL")
        self.client = client or httpx.AsyncClient(follow_redirects=False, trust_env=False)
        self.owns_client = client is None
        self.timeout = timeout_seconds
        self.configured = bool(api_key and provider in defaults)
        self.semaphore = asyncio.Semaphore(3)

    async def aclose(self):
        if self.owns_client:
            await self.client.aclose()

    async def research(self, place, *, city="", visit_date="", purpose="VISIT"):
        # Send only public POI search terms; no conversation, precise GPS or companion data.
        query = (f"{city} {place['name']} 历史沿革 建筑特点 文化故事 景区介绍" if purpose == "KNOWLEDGE" else
                 f"{city} {place['name']} {visit_date} 开放时间 门票 预约 官方").strip()[:300]
        from .place_facts import TICKET_SOURCES
        ticket_source = TICKET_SOURCES.get(place["name"])
        if purpose == "TICKET" and ticket_source:
            query = f"site:{urlsplit(ticket_source[0]).hostname} {place['name']} 门票 旺季 淡季 adult ticket admission peak off season"
        result = {"status": "NOT_CONFIGURED", "query": query, "checkedAt": now_iso(), "references": [],
                  "message": "联网搜索尚未配置，开放时间与票价请向景区确认。"}
        if not self.configured:
            return result
        result.update(status="UNAVAILABLE", message="暂时无法获取联网资料，可稍后重试；现有行程仍可查看。")
        if self.provider == "tavily":
            endpoint = self.base_url if self.base_url.endswith("/search") else self.base_url + "/search"
            payload = {"query": query, "search_depth": "basic", "max_results": 5,
                       "include_answer": False, "include_raw_content": False}
        elif self.provider == "bocha":
            endpoint = (self.base_url if self.base_url.endswith("/web-search") else
                        self.base_url + ("/web-search" if self.base_url.endswith("/v1") else "/v1/web-search"))
            payload = {"query": query, "freshness": "noLimit", "summary": True, "count": 5}
        else:
            endpoint = self.base_url if self.base_url.endswith("/SearchPro") else self.base_url + "/SearchPro"
            payload = {"Query": query}
        try:
            async with self.semaphore:
                async with asyncio.timeout(self.timeout):
                    async with self.client.stream("POST", endpoint, json=payload,
                            headers={"Authorization": "Bearer " + self.api_key,
                                     "Content-Type": "application/json; charset=utf-8"}, timeout=self.timeout) as response:
                        if response.status_code != 200:
                            if response.status_code in (401, 403):
                                result["message"] = "搜索服务暂不可用，请检查服务授权后重试。"
                            elif response.status_code in (429, 432, 433):
                                result["message"] = "搜索服务当前额度不足或请求较多，请稍后重试。"
                            return result
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 1_000_000:
                                return result
                        body = json.loads(data)
            if not isinstance(body, dict):
                return result
            if self.provider == "tavily":
                rows = body.get("results", [])
            elif self.provider == "bocha":
                if body.get("code", 200) not in (200, "200"):
                    return result
                rows = body.get("data", {}).get("webPages", {}).get("value", [])
            else:
                response = body.get("Response", {})
                error = response.get("Error") or body.get("Error")
                if error:
                    code = error.get("Code", "")
                    if code == "ResourceNotFound":
                        result["message"] = "联网搜索服务尚未开通，请在腾讯云控制台开通后重试。"
                    elif code == "ResourceUnavailable":
                        result["message"] = "联网搜索服务当前不可用，请检查腾讯云账户额度后重试。"
                    elif code == "UnauthorizedOperation":
                        result["message"] = "搜索服务暂不可用，请检查服务授权后重试。"
                    elif code.startswith("RequestLimitExceeded"):
                        result["message"] = "搜索请求较多，请稍后重试。"
                    return result
                rows = response.get("Pages", [])
            if not isinstance(rows, list):
                return result
            refs, seen = [], set()
            name = compact(place["name"])
            short_name = compact(re.split(r"[-—·]", place["name"])[-1])
            for row in rows[:10]:
                if isinstance(row, str) and self.provider == "tencent_wsa":
                    try:
                        row = json.loads(row)
                    except ValueError:
                        continue
                if not isinstance(row, dict):
                    continue
                title = row.get("title") or row.get("name")
                snippet = row.get("passage") or row.get("content") or row.get("summary") or row.get("snippet")
                url = row.get("url")
                if not isinstance(title, str) or not isinstance(snippet, str) or not public_url(url):
                    continue
                title = re.sub(r"<[^>]*>", "", html.unescape(title)).strip()
                snippet = re.sub(r"<[^>]*>", "", html.unescape(snippet)).strip()
                if not title or not snippet:
                    continue
                # Qualified map POIs may use a parent prefix absent from web pages. A short name
                # requires the city too; neither match promotes a search snippet to a POI fact.
                text = compact(title + " " + snippet)
                matched = name and name in text
                if purpose == "TICKET" and ticket_source and url.rstrip('/') == ticket_source[0].rstrip('/'):
                    matched = True
                matched = matched or (len(short_name) >= 3 and city and compact(city) in text and short_name in text)
                if not matched or url in seen:
                    continue
                seen.add(url)
                refs.append({"title": title[:200], "url": url, "snippet": snippet[:700],
                             "evidence": {"provider": self.provider, "status": "ESTIMATED", "sourceUrl": url,
                                          "fetchedAt": result["checkedAt"],
                                          "note": "搜索摘要，仅作参考；开放时间、票价和预约要求仍需向景区核实。"}})
                if len(refs) == 3:
                    break
            result.update(status="AVAILABLE" if refs else "EMPTY", references=refs,
                          message="已找到相关资料，请结合到访日期核对景区公告。" if refs else "暂未找到可匹配该景点的资料，请以景区公告为准。")
        except (httpx.HTTPError, TimeoutError, ValueError, TypeError, AttributeError, KeyError):
            pass
        return result
