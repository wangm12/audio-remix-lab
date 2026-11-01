import httpx
import pytest
from fastapi import FastAPI

from app.frontend import mount_frontend


@pytest.fixture
def dist(tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><div id=root></div>")
    (root / "assets" / "app-123.js").write_text("console.log('app')")
    (root / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("top secret")
    return root


@pytest.fixture
async def spa_client(dist):
    spa = FastAPI()

    @spa.get("/api/ping")
    async def ping():
        return {"pong": True}

    mount_frontend(spa, dist)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=spa), base_url="http://testserver") as client:
        yield client


async def test_client_side_routes_fall_back_to_index_html(spa_client):
    for path in ("/", "/songs/123", "/settings"):
        response = await spa_client.get(path)
        assert response.status_code == 200, path
        assert "id=root" in response.text
        assert response.headers["cache-control"] == "no-cache"


async def test_hashed_assets_are_cached_forever_and_other_files_revalidate(spa_client):
    asset = await spa_client.get("/assets/app-123.js")
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    favicon = await spa_client.get("/favicon.svg")
    assert favicon.headers["cache-control"] == "no-cache"


async def test_api_routes_win_and_unknown_api_paths_stay_json_404(spa_client):
    assert (await spa_client.get("/api/ping")).json() == {"pong": True}
    missing = await spa_client.get("/api/nope")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Not Found"}


async def test_path_traversal_never_leaves_dist(spa_client):
    response = await spa_client.get("/%2e%2e/secret.txt")
    assert "top secret" not in response.text


def test_a_missing_build_is_a_clear_startup_error(tmp_path):
    with pytest.raises(RuntimeError, match="npm run build"):
        mount_frontend(FastAPI(), tmp_path / "missing")


async def test_health_endpoint(client):
    response = await client.get("/api/health")
    assert response.json() == {"name": "Song Remix Studio", "version": "0.1.0", "status": "ok"}
