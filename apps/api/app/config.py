"""Only this module reads environment variables. No private values enter capabilities."""
import json
import os
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class Settings:
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])
    amap_key: str = ""
    provider_configs: dict = field(default_factory=dict)
    role_routes: dict = field(default_factory=dict)
    max_body_bytes: int = 524288
    request_timeout_seconds: int = 45
    model_timeout_seconds: int = 60
    content_timeout_seconds: int = 45
    content_max_tokens: int = 1600
    max_job_seconds: int = 180
    job_ttl_seconds: int = 1800
    max_jobs: int = 128
    max_concurrent_jobs: int = 4
    rate_limit_per_minute: int = 120
    max_model_calls_per_job: int = 20
    daily_budget_cny: float = 20.0
    max_tokens: int = 4096
    map_cache_ttl_seconds: int = 0
    amap_cache_authorized: bool = False
    enable_demo: bool = True
    enable_knowledge: bool = False
    search_provider: str = ""
    search_api_key: str = field(default="", repr=False)
    search_base_url: str = ""
    # Built frontend is served on the API origin. Empty/absent builds keep API-only use working.
    web_dist: str | None = None

    def __post_init__(self):
        for key in ("max_body_bytes", "request_timeout_seconds", "model_timeout_seconds", "content_timeout_seconds", "content_max_tokens", "max_job_seconds", "job_ttl_seconds",
                    "max_jobs", "max_concurrent_jobs", "rate_limit_per_minute", "max_model_calls_per_job", "max_tokens"):
            if getattr(self, key) <= 0:
                raise ValueError(f"{key} must be positive")
        if "*" in self.cors_origins:
            raise ValueError("CORS requires explicit origins")
        if self.daily_budget_cny <= 0 or self.map_cache_ttl_seconds < 0:
            raise ValueError("Invalid budget/cache configuration")

    @classmethod
    def from_env(cls):
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)
        providers = {}
        for name, prefix, kind, default_url in (
            ("primary", "PRIMARY", "openai-compatible", "https://api.openai.com/v1"),
            ("secondary", "SECONDARY", "anthropic", "https://api.anthropic.com/v1"),
        ):
            key, model = os.getenv(f"{prefix}_API_KEY", ""), os.getenv(f"{prefix}_MODEL", "")
            if key and model:
                providers[name] = {
                    "kind": os.getenv(f"{prefix}_KIND", kind), "base_url": os.getenv(f"{prefix}_BASE_URL", default_url),
                    "api_key": key, "model": model,
                    "input_cost_per_million": float(os.environ[f"{prefix}_INPUT_CNY_PER_MILLION"]) if os.getenv(f"{prefix}_INPUT_CNY_PER_MILLION") else None,
                    "output_cost_per_million": float(os.environ[f"{prefix}_OUTPUT_CNY_PER_MILLION"]) if os.getenv(f"{prefix}_OUTPUT_CNY_PER_MILLION") else None,
                    "max_tokens": int(os.getenv("TRIPFLOW_MAX_TOKENS", "4096")),
                }
        default_routes = {"A1": "primary", "A7": "secondary"}
        if os.getenv("AIPING_API_KEY"):
            primary_model = os.getenv("AIPING_PRIMARY_MODEL", "DeepSeek-V3.2")
            secondary_model = os.getenv("AIPING_SECONDARY_MODEL", "Qwen3.8-27B")
            providers["aiping"] = {"kind": "openai-compatible", "api_key": os.environ["AIPING_API_KEY"],
                                   "base_url": os.getenv("AIPING_BASE_URL", "https://aiping.cn/api/v1"),
                                   "model": primary_model, "max_tokens": int(os.getenv("TRIPFLOW_MAX_TOKENS", "4096"))}
            default_routes = {"A1": {"provider": "aiping", "model": primary_model}, "A7": {"provider": "aiping", "model": secondary_model}}
        if os.getenv("DEEPSEEK_API_KEY"):
            providers["deepseek"] = {
                "kind": "openai-compatible", "api_key": os.environ["DEEPSEEK_API_KEY"],
                "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                "max_tokens": int(os.getenv("TRIPFLOW_MAX_TOKENS", "4096")),
                "input_cost_per_million": float(os.environ["DEEPSEEK_INPUT_CNY_PER_MILLION"]) if os.getenv("DEEPSEEK_INPUT_CNY_PER_MILLION") else None,
                "output_cost_per_million": float(os.environ["DEEPSEEK_OUTPUT_CNY_PER_MILLION"]) if os.getenv("DEEPSEEK_OUTPUT_CNY_PER_MILLION") else None,
            }
            # Default to the measured direct route; explicit MODEL_ROUTES still wins.
            default_routes["A1"] = "deepseek"
            default_routes["A7"] = "deepseek"
        values = {"provider_configs": providers, "amap_key": os.getenv("AMAP_WEB_SERVICE_KEY") or os.getenv("AMAP_API_KEY", ""),
                  "role_routes": json.loads(os.getenv("MODEL_ROUTES", json.dumps(default_routes)))}
        for name in ("max_body_bytes", "request_timeout_seconds", "model_timeout_seconds", "content_timeout_seconds", "content_max_tokens", "max_job_seconds", "job_ttl_seconds", "max_jobs",
                     "max_concurrent_jobs", "rate_limit_per_minute", "max_model_calls_per_job", "max_tokens", "map_cache_ttl_seconds"):
            if f"TRIPFLOW_{name.upper()}" in os.environ:
                values[name] = int(os.environ[f"TRIPFLOW_{name.upper()}"])
        if os.getenv("CORS_ORIGINS"):
            values["cors_origins"] = [s.strip() for s in os.environ["CORS_ORIGINS"].split(",") if s.strip()]
        values["daily_budget_cny"] = float(os.getenv("TRIPFLOW_DAILY_BUDGET_CNY", "20"))
        values["enable_demo"] = os.getenv("TRIPFLOW_ENABLE_DEMO", "true").lower() == "true"
        values["amap_cache_authorized"] = os.getenv("TRIPFLOW_AMAP_CACHE_AUTHORIZED", "false").lower() == "true"
        values["enable_knowledge"] = os.getenv("TRIPFLOW_ENABLE_KNOWLEDGE", "true").lower() == "true"
        search_provider = os.getenv("TRIPFLOW_SEARCH_PROVIDER", os.getenv("SEARCH_PROVIDER", "")).strip().lower()
        search_provider = {"tencent": "tencent_wsa", "wsa": "tencent_wsa", "tencentcloud": "tencent_wsa"}.get(search_provider, search_provider)
        if not search_provider:
            search_provider = "tencent_wsa" if os.getenv("TENCENTCLOUD_WSA_APIKEY") else next((name for name in ("tavily", "bocha") if os.getenv(name.upper() + "_API_KEY")), "")
        if search_provider not in ("", "tavily", "bocha", "tencent_wsa"):
            raise ValueError("Unsupported search provider")
        search_key_name = "TENCENTCLOUD_WSA_APIKEY" if search_provider == "tencent_wsa" else search_provider.upper() + "_API_KEY"
        search_url_name = "TENCENTCLOUD_WSA_API_URL" if search_provider == "tencent_wsa" else search_provider.upper() + "_BASE_URL"
        values.update(search_provider=search_provider,
                      search_api_key=os.getenv(search_key_name, "") or os.getenv("SEARCH_API_KEY", ""),
                      search_base_url=os.getenv(search_url_name, "") or os.getenv("SEARCH_BASE_URL", ""))
        values["web_dist"] = os.getenv("TRIPFLOW_WEB_DIST") or None
        return cls(**values)
