import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def geo_policy():
    from .schemas import GeoPolicy
    path = Path(__file__).resolve().parents[3] / "packages/context-engine/geo-policy.json"
    return GeoPolicy.model_validate(json.loads(path.read_text(encoding="utf-8")))
