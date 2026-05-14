import httpx

from app.engines.base import AbstractEngine
from app.config import settings


class SunoEngine(AbstractEngine):
    name = "suno"

    def __init__(self):
        self.base_url = settings.SUNO_API_BASE.rstrip("/")
        self.client = httpx.AsyncClient(timeout=120.0)

    async def submit_cover(
        self,
        source_audio_path: str,
        caption: str,
        cover_strength: float = 0.5,
        vocal_gender: str = "auto",
        lyrics: str | None = None,
        vocal_language: str = "en",
    ) -> str:
        payload = {
            "prompt": lyrics or "",
            "tags": caption,
            "title": "R&B Cover",
            "make_instrumental": False,
            "wait_audio": False,
        }
        resp = await self.client.post(
            f"{self.base_url}/api/custom_generate",
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        # suno-api returns a list of clip objects
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("id", "")
        return data.get("id", str(data))

    async def poll_result(self, task_id: str) -> dict:
        resp = await self.client.get(f"{self.base_url}/api/get?ids={task_id}")
        resp.raise_for_status()
        data = resp.json()
        clips = data if isinstance(data, list) else [data]
        if not clips:
            return {"status": 0}

        clip = clips[0]
        suno_status = clip.get("status", "")
        if suno_status == "complete":
            return {
                "status": 1,
                "audio_url": clip.get("audio_url", ""),
                "metadata": clip,
            }
        elif suno_status in ("error", "failed"):
            return {
                "status": 2,
                "error": clip.get("error_message", "Suno generation failed"),
            }
        return {"status": 0}

    async def download_audio(self, audio_ref: str) -> bytes:
        resp = await self.client.get(audio_ref, follow_redirects=True)
        resp.raise_for_status()
        return resp.content

    async def health_check(self) -> dict:
        try:
            resp = await self.client.get(f"{self.base_url}/api/get_limit", timeout=5.0)
            resp.raise_for_status()
            return {"healthy": True, "engine": self.name, "info": resp.json()}
        except Exception as e:
            return {"healthy": False, "engine": self.name, "error": str(e)}

    async def close(self):
        await self.client.aclose()
