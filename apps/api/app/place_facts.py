"""Date-aware policy parsing from map listings and reviewed official sources."""
from __future__ import annotations

import copy
import html
import re
from datetime import date
from urllib.parse import urlsplit

import httpx

from .jobs import now_iso


def opening_windows(text, visit_date):
    """Resolve common Amap day/month policies before the strict clock parser."""
    from .validation import _opening_windows
    day = date.fromisoformat(str(visit_date)[:10])
    text = text.strip()
    if re.search(r"节假日|法定", text) and day.weekday() == 0:
        # Without a holiday calendar, a Monday exception remains unresolved.
        return None
    # Select the month policy, including ranges crossing New Year.
    date_range = r"(\d{1,2})月(\d{1,2})日[至到-](\d{1,2})月(\d{1,2})日"
    blocks = list(re.finditer(date_range, text))
    if blocks:
        selected = None
        for i, m in enumerate(blocks):
            m1, d1, m2, d2 = map(int, m.groups())
            lo, hi, today = (m1, d1), (m2, d2), (day.month, day.day)
            if (lo <= today <= hi) if lo <= hi else (today >= lo or today <= hi):
                selected = text[m.end():blocks[i+1].start() if i+1 < len(blocks) else len(text)]
                break
        if selected is None:
            return None
        text = selected
    elif re.search(r"\d+月", text):
        choices = text.split("；")
        selected = []
        for block in choices:
            spans = re.findall(r"(\d{1,2})月至(\d{1,2})月", block)
            if spans and any(int(a) <= day.month <= int(b) for a, b in spans):
                selected.append(re.sub(r"\d{1,2}月至\d{1,2}月[,，]?", "", block))
        if len(selected) != 1:
            return None
        text = selected[0]
    weekdays = "一二三四五六日"
    weekly = re.search(r"周([一二三四五六日天])至周([一二三四五六日天])", text)
    if weekly:
        lo = weekdays.index(weekly[1].replace("天", "日"))
        hi = weekdays.index(weekly[2].replace("天", "日"))
        if not lo <= day.weekday() <= hi:
            return []
        text = text.replace(weekly[0], "")
    elif re.search(r"[周星期]", text):
        return None
    text = re.sub(r"周[一二三四五六日天]全天关闭.*", "", text)
    text = re.sub(r"[,，]?节假日营业时间以官方通知为准", "", text)
    # Last-entry clocks are not additional opening windows. Sub-attraction
    # policies never narrow/widen the parent park's main admission interval.
    text = re.split(r"最晚进入|园中园|[（(]|\d{1,2}:\d{2}停止", text)[0]
    text = text.strip(" ,，;；每日全年")
    if text in {"24小时营业", "24小时开放"}:
        text = "00:00-24:00"
    return _opening_windows(text)


# Fixed, reviewed public endpoints; never follow a user/model-supplied URL.
# Prices are extracted from a freshly fetched page, not stored in this table.
TICKET_SOURCES = {
    "故宫博物院": ("https://www.dpm.org.cn/Visit.html", r"旺季.{0,100}?大?门票\s*(\d+)\s*元", r"淡季.{0,100}?大?门票\s*(\d+)\s*元"),
    "八达岭长城": ("https://s.visitbeijing.com.cn/attraction/101406", r"成人票.{0,10}?旺季\s*(\d+)\s*元", r"成人票.{0,40}?淡季\s*(\d+)\s*元"),
    "颐和园": ("https://s.visitbeijing.com.cn/attraction/101407", r"颐和园门票[：:]\s*(\d+)\s*元/张[（(]旺季", r"颐和园门票[：:].{0,40}?(\d+)\s*元/张[（(]淡季"),
    "天坛公园": ("https://s.visitbeijing.com.cn/attraction/101409", r"旺季[：:].{0,50}?门票[：:]\s*(\d+)\s*元", r"淡季[：:].{0,50}?门票[：:]\s*(\d+)\s*元"),
}


async def verify_ticket(place, visit_date, client, references=()):
    result = copy.deepcopy(place)
    if not visit_date:
        return result
    today = date.fromisoformat(visit_date[:10])
    source = TICKET_SOURCES.get(place["name"])
    location = place["location"]
    urls = []
    if source and 115 < location["lng"] < 118 and 39 < location["lat"] < 42:
        urls.append((source[0], source[1] if 4 <= today.month <= 10 else source[2]))
    # Other cities: only simple, unambiguous full-price/free admission notices
    # on government/known operator sites, fetched in full after search discovery.
    for ref in references:
        host = urlsplit(ref["url"]).hostname or ""
        if host.endswith(".gov.cn") and place["name"] in ref["title"] + ref["snippet"]:
            urls.append((ref["url"], None))
    for url, pattern in urls[:3]:
        try:
            async with client.stream("GET", url, timeout=5, follow_redirects=False) as response:
                if response.status_code != 200:
                    continue
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 1_000_000:
                        break
                if len(content) > 1_000_000:
                    continue
                raw = content.decode(response.encoding or "utf-8", errors="replace")
            raw = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", "", raw, flags=re.S | re.I)
            text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))
            if place["name"] == "八达岭长城" and source and url == source[0]:
                policies = []
                for label, span in (("旺季", "4月1日至10月31日"), ("淡季", "11月1日至3月31日")):
                    match = re.search(label + r"[（(]每年.{0,40}?营业时间.{0,30}?[：:]\s*(\d{1,2}:\d{2})[～~至-](\d{1,2}:\d{2})", text)
                    if match:
                        policies.append(f"{span} {match[1]}-{match[2]}")
                if len(policies) == 2:
                    result["openingHours"] = {"value": "；".join(policies), "evidence": {
                        "provider": "official-admission", "status": "VERIFIED", "sourceUrl": url, "fetchedAt": now_iso(),
                        "note": "官方分季节检票开放时段；排程保守地要求在检票时段内完成游览，临时公告优先。"}}
            price = None
            if pattern:
                match = re.search(pattern, text, re.I)
                if match:
                    price = float(match[1])
            elif place["name"] in text:
                # Restrict to a paragraph associated with this exact named POI.
                for match in re.finditer(re.escape(place["name"]), text):
                    block = text[match.start():match.start()+220]
                    if re.search(r"淡季|旺季|节假日|优惠|儿童|老人|学生|限时|活动期间", block):
                        continue
                    if re.search(r"免费开放|免收门票|门票免费|无需门票", block):
                        price = 0
                    amounts = re.findall(r"(?:成人门票|成人票|全价票|门票价格)[：:为\s]*(\d+(?:\.\d+)?)\s*元", block)
                    if len(set(amounts)) == 1:
                        price = float(amounts[0])
                    if price is not None:
                        break
            if price is not None:
                result["ticketPriceCny"] = {"value": price, "evidence": {
                    "provider": "official-admission", "status": "VERIFIED", "sourceUrl": url,
                    "fetchedAt": now_iso(), "note": f"到访日期{visit_date}，成人普通大门票单价；不含园中园、索道及优惠资格。按人数计算标准票预算，非实际成交报价。"}}
                break
        except (httpx.HTTPError, ValueError, UnicodeError):
            continue
    # A search index can retrieve the exact reviewed official page when its web
    # server rejects automated GETs. Only this fixed URL/parser pair is allowed;
    # third-party snippets, inferred prices and generic "official" titles cannot
    # establish a verified ticket. Preserve indexed provenance explicitly.
    if source and urls and result.get("ticketPriceCny", {}).get("evidence", {}).get("status") != "VERIFIED":
        pattern = source[1] if 4 <= today.month <= 10 else source[2]
        for ref in references:
            if ref["url"].rstrip('/') != source[0].rstrip('/'):
                continue
            match = re.search(pattern, ref["snippet"], re.I)
            if match:
                result["ticketPriceCny"] = {"value": float(match[1]), "evidence": {
                    "provider": "official-search-index", "status": "VERIFIED", "sourceUrl": source[0],
                    "fetchedAt": ref["evidence"].get("fetchedAt") or now_iso(),
                    "note": f"到访日期{visit_date}，已匹配官方页面与对应季节成人大门票条款（经搜索索引读取，非实时售票库存）；不含优惠票、园中园、索道。"}}
                break
    return result
