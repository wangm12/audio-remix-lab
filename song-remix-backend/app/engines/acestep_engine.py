import json
import logging
import os
import re

import httpx

from app.engines.base import AbstractEngine
from app.config import settings


GENDER_HINTS = {
    "female": "female vocals, solo female singer",
    "male": "male vocals, solo male singer",
}

logger = logging.getLogger(__name__)


def _public_health_info(payload: object) -> dict:
    """Project the upstream health contract onto safe public scalar fields."""
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data", payload)
    if not isinstance(data, dict):
        return {}

    info = {}
    if data.get("status") in {"ok", "healthy", "degraded"}:
        info["status"] = data["status"]
    if data.get("service") == "ACE-Step API":
        info["service"] = "ACE-Step API"
    version = data.get("version")
    if isinstance(version, str) and re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){0,2}", version):
        info["version"] = version
    for key in ("models_initialized", "llm_initialized"):
        if isinstance(data.get(key), bool):
            info[key] = data[key]
    return info


class ACEStepEngine(AbstractEngine):
    name = "acestep"

    def __init__(self):
        self.base_url = settings.ACESTEP_API_BASE.rstrip("/")
        self.client = httpx.AsyncClient(timeout=300.0)

    @staticmethod
    def _build_prompt(caption: str, vocal_gender: str) -> str:
        hint = GENDER_HINTS.get(vocal_gender)
        if not hint:
            return caption
        if hint.split(",")[0] in caption.lower():
            return caption
        return f"{caption}, {hint}" if caption else hint

    async def submit_cover(
        self,
        source_audio_path: str,
        caption: str,
        cover_strength: float = 0.5,
        vocal_gender: str = "auto",
        lyrics: str | None = None,
        vocal_language: str = "en",
    ) -> str:
        prompt = self._build_prompt(caption, vocal_gender)
        data = {
            "task_type": "cover",
            "prompt": prompt,
            "audio_cover_strength": str(cover_strength),
            "vocal_language": vocal_language,
            "batch_size": "1",
        }
        if lyrics:
            data["lyrics"] = lyrics

        if source_audio_path and os.path.isfile(source_audio_path):
            with open(source_audio_path, "rb") as f:
                files = {"src_audio": (os.path.basename(source_audio_path), f, "audio/mpeg")}
                resp = await self.client.post(
                    f"{self.base_url}/release_task", data=data, files=files
                )
        else:
            json_payload = {
                "task_type": "text2music",
                "prompt": prompt,
                "vocal_language": vocal_language,
                "batch_size": 1,
            }
            if lyrics:
                json_payload["lyrics"] = lyrics
            resp = await self.client.post(
                f"{self.base_url}/release_task", json=json_payload
            )

        resp.raise_for_status()
        return resp.json()["data"]["task_id"]

    async def poll_result(self, task_id: str) -> dict:
        resp = await self.client.post(
            f"{self.base_url}/query_result",
            json={"task_id_list": [task_id]},
        )
        resp.raise_for_status()
        items = resp.json()["data"]
        if not items:
            return {"status": 0}

        item = items[0]
        status = item.get("status", 0)

        if status == 1:
            result_raw = item.get("result", "[]")
            try:
                results = json.loads(result_raw) if isinstance(result_raw, str) else result_raw
            except json.JSONDecodeError:
                results = []
            audio_url = ""
            if results and isinstance(results, list):
                audio_url = results[0].get("file", "")
            return {"status": 1, "audio_url": audio_url, "metadata": results}

        if status == 2:
            return {"status": 2, "error": item.get("error", "Engine reported failure")}

        return {"status": 0}

    async def download_audio(self, audio_ref: str) -> bytes:
        if audio_ref.startswith("/"):
            url = f"{self.base_url}{audio_ref}"
        else:
            url = f"{self.base_url}/v1/audio?path={audio_ref}"
        resp = await self.client.get(url)
        resp.raise_for_status()
        return resp.content

    async def health_check(self) -> dict:
        try:
            resp = await self.client.get(f"{self.base_url}/health", timeout=5.0)
            resp.raise_for_status()
            return {"healthy": True, "engine": self.name, "info": _public_health_info(resp.json())}
        except Exception:
            logger.exception("ACE-Step health check failed")
            return {"healthy": False, "engine": self.name, "error": "Engine health check failed"}

    async def close(self):
        await self.client.aclose()
