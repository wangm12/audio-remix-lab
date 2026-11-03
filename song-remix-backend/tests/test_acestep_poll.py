import asyncio
import json
import logging

import httpx
import pytest

from app.engines import acestep_engine
from app.engines.acestep_engine import ACEStepEngine


async def _engine(handler):
    engine = ACEStepEngine()
    await engine.close()
    engine.base_url = "http://acestep.test"
    engine.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=300.0)
    return engine


def _query_result_response(status: int) -> httpx.Response:
    item = {"task_id": "upstream-123", "status": status, "result": '[{"file":"/v1/audio?path=output.mp3"}]'}
    return httpx.Response(200, json={"data": [item]})


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (0, {"status": 0}),
        (
            1,
            {
                "status": 1,
                "audio_url": "/v1/audio?path=output.mp3",
                "metadata": [{"file": "/v1/audio?path=output.mp3"}],
            },
        ),
    ],
)
async def test_read_error_reissues_one_query_and_preserves_response(status, expected, caplog):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path == "/query_result"
        assert json.loads(request.content) == {"task_id_list": ["upstream-123"]}
        if len(requests) == 1:
            raise httpx.ReadError("")
        return _query_result_response(status)

    engine = await _engine(handler)
    caplog.set_level(logging.WARNING, logger="app.engines.acestep_engine")
    try:
        result = await engine.poll_result("upstream-123")
    finally:
        await engine.close()

    assert result == expected
    assert len(requests) == 2
    record = next(record for record in caplog.records if "retrying once" in record.getMessage())
    assert record.exc_info is not None
    assert record.exc_info[0] is httpx.ReadError
    assert "upstream-123" in record.getMessage()


async def test_second_read_error_is_raised_after_exactly_two_queries():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise httpx.ReadError(f"read failure {len(requests)}")

    engine = await _engine(handler)
    try:
        with pytest.raises(httpx.ReadError, match="read failure 2"):
            await engine.poll_result("upstream-123")
    finally:
        await engine.close()

    assert len(requests) == 2


@pytest.mark.parametrize("failure", ["read_timeout", "connect_error", "http_5xx", "invalid_json"])
async def test_non_read_error_is_not_retried(failure):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if failure == "read_timeout":
            raise httpx.ReadTimeout("read timed out")
        if failure == "connect_error":
            raise httpx.ConnectError("connect failed")
        if failure == "http_5xx":
            return httpx.Response(503, json={"detail": "unavailable"})
        return httpx.Response(200, content=b"{")

    engine = await _engine(handler)
    try:
        with pytest.raises((httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError, json.JSONDecodeError)):
            await engine.poll_result("upstream-123")
    finally:
        await engine.close()

    assert len(requests) == 1


class _DelayedStream(httpx.AsyncByteStream):
    def __init__(self, delay: float, *, read_error: bool = False) -> None:
        self.delay = delay
        self.read_error = read_error

    async def __aiter__(self):
        await asyncio.sleep(self.delay)
        if self.read_error:
            raise httpx.ReadError("delayed response read failure")
        yield b'{"data":[{"status":0}]}'

    async def aclose(self) -> None:
        return None


async def test_retry_uses_remaining_time_from_the_original_budget(monkeypatch):
    monkeypatch.setattr(acestep_engine, "POLL_RESULT_TIMEOUT_SECONDS", 0.5)
    requests = []
    retry_read_timeout = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal retry_read_timeout
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, stream=_DelayedStream(0.3, read_error=True))
        retry_read_timeout = request.extensions["timeout"]["read"]
        return httpx.Response(200, stream=_DelayedStream(1))

    engine = await _engine(handler)
    started = asyncio.get_running_loop().time()
    try:
        with pytest.raises(TimeoutError):
            await engine.poll_result("upstream-123")
    finally:
        await engine.close()
    elapsed = asyncio.get_running_loop().time() - started

    assert len(requests) == 2
    assert retry_read_timeout is not None and 0 < retry_read_timeout <= 0.22
    assert 0.45 <= elapsed < 0.68
