"""Bounded, title-and-coordinate-matched public reference retrieval (never official policy)."""
import httpx
from .jobs import now_iso
from .providers import ProviderError, to_gcj02
from .proactive import distance


class KnowledgeProvider:
    def __init__(self, client=None, timeout_seconds=8):
        self.client = client or httpx.AsyncClient(follow_redirects=False, trust_env=False)
        self.owns_client = client is None
        self.timeout = timeout_seconds

    async def aclose(self):
        if self.owns_client:
            await self.client.aclose()

    async def lookup(self, place):
        """No arbitrary client URL, fuzzy page binding, HTML, or remotely executable tools."""
        try:
            response = await self.client.get("https://zh.wikipedia.org/w/api.php", params={
                "action": "query", "format": "json", "formatversion": 2, "prop": "extracts|coordinates|info",
                "titles": place["name"], "exintro": 1, "explaintext": 1, "exchars": 1000, "inprop": "url", "colimit": 1,
            }, headers={"User-Agent": "TripFlow/1.0 (travel reference lookup)"}, timeout=self.timeout)
            if response.status_code != 200 or len(response.content) > 100000:
                return None
            pages = response.json().get("query", {}).get("pages", [])
            if len(pages) != 1:
                return None
            page = pages[0]
            if page.get("missing") or page.get("title") != place["name"] or not page.get("extract"):
                return None
            coords = page.get("coordinates") or []
            if not coords or coords[0].get("globe", "earth") != "earth":
                return None
            coord = {"lat": coords[0]["lat"], "lng": coords[0]["lon"], "coordinateSystem": "WGS84"}
            if distance(to_gcj02(coord), to_gcj02(place["location"])) > 5000:
                return None
            url = page.get("fullurl", "")
            if not url.startswith("https://zh.wikipedia.org/"):
                return None
            return {"text": page["extract"][:1200], "evidence": {"provider": "wikipedia", "externalId": str(page["pageid"]),
                    "fetchedAt": now_iso(), "status": "VERIFIED", "sourceUrl": url,
                    "note": "同名且坐标接近的百科参考资料，CC BY-SA；非官方管理政策，VERIFIED仅表示来源已获取并匹配。"}}
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            return None
