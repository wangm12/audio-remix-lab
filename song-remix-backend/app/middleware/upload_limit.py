import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

MULTIPART_OVERHEAD_BYTES = 64 * 1024
_SOURCE_PATH = re.compile(r"^/api/songs/[^/]+/source$")


class UploadLimitMiddleware:
    """Reject oversized song-source uploads before Starlette spools the multipart body."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or not _SOURCE_PATH.match(scope["path"]):
            await self.app(scope, receive, send)
            return

        limit = settings.MAX_UPLOAD_MB * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES
        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > limit:
                    await self._reject(send)
                    return
                break

        received = 0
        started = False
        rejected = False

        async def counting_receive() -> Message:
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # The framework turns exceptions raised while parsing the body into 400s,
                    # so answer here, then report a disconnect to stop it reading further.
                    rejected = True
                    if not started:
                        await self._reject(send)
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if rejected and not started:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        await self.app(scope, counting_receive, tracking_send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = f'{{"detail":"File too large (max {settings.MAX_UPLOAD_MB} MB)"}}'.encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
