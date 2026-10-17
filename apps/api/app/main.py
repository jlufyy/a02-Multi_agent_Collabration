import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import schemas as s
from .config import Settings
from .errors import AppError, public_error
from .jobs import JobManager, dump
from .middleware import RequestGuard
from .providers import AmapProvider, ProviderError
from .gateway import ModelGateway
from .workflows import Workflows
from .planning import PlanningError
from .knowledge import KnowledgeProvider
from .web_search import WebSearchProvider
from .geo_policy import geo_policy

ROOT = Path(__file__).resolve().parents[3]


def create_app(settings=None, maps=None, gateway=None, search=None):
    settings = settings or Settings.from_env()
    maps = maps or AmapProvider(settings.amap_key, cache_ttl_seconds=settings.map_cache_ttl_seconds,
                                cache_authorized=settings.amap_cache_authorized)
    gateway = gateway or ModelGateway(settings.provider_configs, settings.role_routes,
                                      timeout_seconds=settings.model_timeout_seconds,
                                      role_limits={"A7": {"timeout_seconds": settings.content_timeout_seconds, "max_tokens": settings.content_max_tokens}},
                                      max_calls_per_job=settings.max_model_calls_per_job,
                                      daily_budget_cny=settings.daily_budget_cny)
    jobs = JobManager(settings, gateway=gateway)
    search = search or WebSearchProvider(settings.search_provider, settings.search_api_key, settings.search_base_url)
    knowledge = KnowledgeProvider(search=search, wikipedia_enabled=settings.enable_knowledge) if settings.enable_knowledge or search.configured else None
    workflows = Workflows(maps, gateway, knowledge)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await jobs.close()
        await maps.aclose()
        await gateway.aclose()
        if knowledge:
            await knowledge.aclose()
        await search.aclose()

    app = FastAPI(title="TripFlow Backend", version="1.0.0", lifespan=lifespan,
                  description="TripFlow-Split-v1. Browser owns confirmed plans; this API returns ephemeral proposals only.")
    app.state.jobs, app.state.workflows, app.state.settings = jobs, workflows, settings
    app.add_middleware(RequestGuard, settings=settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Content-Type", "X-Request-Id"], expose_headers=["X-Request-Id"], allow_credentials=False)

    def envelope(request, data, status="SUCCEEDED", errors=None, request_id=None, trace_id=None):
        return {"request_id": request_id or request.state.request_id, "status": status, "data": dump(data),
                "errors": errors or [], "trace_id": trace_id or request.state.trace_id}

    @app.exception_handler(AppError)
    @app.exception_handler(ProviderError)
    async def app_error(request, exc):
        return JSONResponse(envelope(request, None, "FAILED", [public_error(exc)]), status_code=exc.http_status)

    @app.exception_handler(PlanningError)
    async def planning_error(request, exc):
        return JSONResponse(envelope(request, None, "FAILED", [{"code": exc.code, "message": exc.message, "retryable": False}]), status_code=422)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        errors = []
        stale = False
        for error in exc.errors():
            stale = stale or "STALE_REVISION" in error["msg"]
            errors.append({"code": "STALE_REVISION" if "STALE_REVISION" in error["msg"] else "VALIDATION_ERROR",
                           "message": error["msg"], "retryable": False,
                           "fieldPath": ".".join(str(p) for p in error["loc"] if p != "body") or "body"})
        return JSONResponse(envelope(request, None, "FAILED", errors), status_code=409 if stale else 422)

    from starlette.exceptions import HTTPException
    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(envelope(request, None, "FAILED", [{"code": "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
                            "message": "请求路径或方法不可用。", "retryable": False}]), status_code=exc.status_code)

    def capabilities():
        model_routes = []
        for agent in ("A1", "A7"):
            route = settings.role_routes.get(agent, settings.role_routes.get("default", "unconfigured"))
            name = route.get("provider", "unconfigured") if isinstance(route, dict) else route
            cfg = settings.provider_configs.get(name, {})
            model_routes.append({"agentId": agent, "provider": name, "model": (route.get("model") if isinstance(route, dict) else None) or cfg.get("model", "unconfigured"),
                                 "available": bool(cfg.get("api_key") and cfg.get("model"))})
        content = next(r["available"] for r in model_routes if r["agentId"] == "A7")
        return s.CapabilitySet.model_validate({
            "planning": maps.configured, "poiSearch": maps.configured,
            "routes": ["WALK", "TRANSIT", "DRIVE"] if maps.configured else [], "content": content,
            "nearby": maps.configured, "demo": settings.enable_demo,
            "tools": [{"name": "amap", "available": maps.configured, "reason": "已配置，真实联调状态见交付记录" if maps.configured else "未配置高德 Web Service Key"},
                      {"name": "model_gateway", "available": gateway.configured, "reason": "可用性表示配置就绪，不代表供应商连通性验收"},
                      {"name": "web_search", "available": search.configured, "reason": "联网搜索已配置" if search.configured else "联网搜索尚未配置"}],
            "modelRoutes": model_routes,
            "limits": {"pollIntervalMs": 1000, "maxPollIntervalMs": 10000, "jobTtlSeconds": settings.job_ttl_seconds,
                       "requestTimeoutSeconds": settings.request_timeout_seconds, "maxJobSeconds": settings.max_job_seconds,
                       "maxBodyBytes": settings.max_body_bytes},
            "geoPolicy": dump(geo_policy())})

    @app.get("/api/v1/health", response_model=s.ApiResponse[s.HealthResult], response_model_exclude_none=True)
    async def health(request: Request):
        caps = capabilities()
        return envelope(request, s.HealthResult(serviceStatus="OK" if caps.planning and caps.content else "DEGRADED", version="1.0.0", capabilities=caps))

    @app.get("/api/v1/capabilities", response_model=s.ApiResponse[s.CapabilitySet], response_model_exclude_none=True)
    async def capability_endpoint(request: Request):
        return envelope(request, capabilities())

    def check_demo(body):
        if body.executionMode == "DEMO" and not settings.enable_demo:
            raise AppError("DEMO_DISABLED", "此实例未启用演示事件。", 422)

    def submit(request, body, operation):
        check_demo(body)
        job = jobs.submit(request.url.path, request.state.request_id, request.state.trace_id, body,
                          lambda job: operation(body, job))
        return envelope(request, job.accepted(), "PENDING" if job.status == "PENDING" else "RUNNING",
                        request_id=job.request_id, trace_id=job.trace_id)

    @app.post("/api/v1/requirements/parse", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def parse(request: Request, body: s.ParseRequirementsRequest):
        return submit(request, body, workflows.parse)

    @app.post("/api/v1/plans/generate", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def generate(request: Request, body: s.GeneratePlanRequest):
        return submit(request, body, workflows.generate)

    @app.post("/api/v1/revisions/propose", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def propose(request: Request, body: s.ProposeRevisionRequest):
        return submit(request, body, workflows.propose)

    @app.post("/api/v1/revisions/validate", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def validate(request: Request, body: s.ValidateRevisionRequest):
        return submit(request, body, workflows.validate)

    @app.post("/api/v1/proactive/evaluate", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def proactive(request: Request, body: s.EvaluateProactiveRequest):
        return submit(request, body, workflows.proactive)

    @app.post("/api/v1/content/prepare", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def prepare(request: Request, body: s.PrepareContentRequest):
        return submit(request, body, workflows.prepare)

    @app.post("/api/v1/content/refine", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def refine(request: Request, body: s.RefineContentRequest):
        return submit(request, body, workflows.refine)

    @app.post("/api/v1/nearby/search", status_code=202, response_model=s.ApiResponse[s.JobAccepted], response_model_exclude_none=True)
    async def nearby(request: Request, body: s.NearbySearchRequest):
        return submit(request, body, workflows.nearby)

    @app.post("/api/v1/places/search", response_model=s.ApiResponse[s.SearchPlacesResult], response_model_exclude_none=True)
    async def places(request: Request, body: s.SearchPlacesRequest):
        check_demo(body)
        found = await maps.search_pois(body.keyword, city=body.city, location=dump(body.location) if body.location else None)
        return envelope(request, s.SearchPlacesResult(places=found))

    @app.post("/api/v1/routes/segments", response_model=s.ApiResponse[s.RouteSegmentsResult], response_model_exclude_none=True)
    async def routes(request: Request, body: s.RouteSegmentsRequest):
        check_demo(body)
        data = await workflows.route_segments(body.requirements, body.activities, body.mode)
        return envelope(request, data, "PARTIAL" if data.warnings else "SUCCEEDED")

    @app.post("/api/v1/places/research", response_model=s.ApiResponse[s.WebResearch], response_model_exclude_none=True)
    async def research_place(request: Request, body: s.ResearchPlaceRequest):
        check_demo(body)
        place = await maps.poi_detail(body.poiId)
        research = await search.research(place, city=body.city, visit_date=body.visitDate)
        return envelope(request, research, "SUCCEEDED" if research["status"] == "AVAILABLE" else "PARTIAL")

    JobResult = s.ParseRequirementsResult | s.PlanResult | s.RevisionOutcome | s.ContentOutcome | s.ClarificationOutcome | s.ValidateRevisionResult | s.EvaluateProactiveResult | s.PrepareContentResult | s.RefineContentResult | s.NearbySearchResult

    @app.get("/api/v1/jobs/{job_id}", response_model=s.ApiResponse[s.JobSnapshot[JobResult]], response_model_exclude_none=True)
    async def get_job(request: Request, job_id: str, afterSequence: int = Query(default=0, ge=0)):
        job = jobs.get(job_id)
        return envelope(request, job.snapshot(afterSequence), job.status, job.errors,
                        request_id=job.request_id, trace_id=job.trace_id)

    @app.delete("/api/v1/jobs/{job_id}", response_model=s.ApiResponse[s.CancelJobResult], response_model_exclude_none=True)
    async def cancel_job(request: Request, job_id: str):
        job = jobs.cancel(job_id)
        return envelope(request, {"jobId": job.job_id, "status": job.status})

    for route in app.routes:
        if hasattr(route, "response_model_exclude_none"):
            route.response_model_exclude_none = True
    # HashRouter keeps deep links in the fragment; no catch-all HTML API fallback is needed.
    web_dist = Path(settings.web_dist) if settings.web_dist else ROOT / "tripflow-frontend/tripflow/apps/web/dist"
    if (web_dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return app


app = create_app()
