"""Integration packaging checks; no paid providers or synthetic success claims."""
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_web_and_api_share_origin_without_exposing_workspace(tmp_path):
    (tmp_path / "index.html").write_text('<div id="root">TripFlow</div>', encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/app.js").write_text("console.log('web');", encoding="utf-8")
    with TestClient(create_app(Settings(web_dist=str(tmp_path)))) as client:
        assert 'id="root"' in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/v1/health").json()["data"]["serviceStatus"] == "DEGRADED"
        for path in ("/.env", "/apps/api/app/config.py", "/api/v1/missing", "/assets/missing.js"):
            response = client.get(path)
            assert response.status_code == 404
            assert response.headers["content-type"].startswith("application/json")
        assert client.get("/openapi.json").status_code == 200


def test_deepseek_routes_and_explicit_override(monkeypatch):
    monkeypatch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: None)
    for key in ("MODEL_ROUTES", "PRIMARY_API_KEY", "PRIMARY_MODEL", "SECONDARY_API_KEY", "SECONDARY_MODEL", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "synthetic-direct-key")
    monkeypatch.setenv("AIPING_API_KEY", "synthetic-aggregator-key")
    settings = Settings.from_env()
    assert settings.role_routes["A1"] == "deepseek"
    assert settings.role_routes["A7"]["provider"] == "aiping"
    assert settings.provider_configs["deepseek"]["base_url"] == "https://api.deepseek.com"
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/api/v1/capabilities")
        assert "synthetic-direct-key" not in response.text
        assert "synthetic-aggregator-key" not in response.text
        routes = {r["agentId"]: r["provider"] for r in response.json()["data"]["modelRoutes"]}
        assert routes == {"A1": "deepseek", "A7": "aiping"}
    monkeypatch.setenv("MODEL_ROUTES", '{"A1":"aiping","A7":"deepseek"}')
    assert Settings.from_env().role_routes == {"A1": "aiping", "A7": "deepseek"}
    monkeypatch.delenv("MODEL_ROUTES")
    monkeypatch.delenv("AIPING_API_KEY")
    assert Settings.from_env().role_routes == {"A1": "deepseek", "A7": "deepseek"}
