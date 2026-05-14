from abc import ABC, abstractmethod


class AbstractEngine(ABC):
    name: str

    @abstractmethod
    async def submit_cover(
        self,
        source_audio_path: str,
        caption: str,
        cover_strength: float = 0.5,
        vocal_gender: str = "auto",
        lyrics: str | None = None,
        vocal_language: str = "en",
    ) -> str:
        """Submit a cover generation task. Returns an engine-specific task ID."""

    @abstractmethod
    async def poll_result(self, task_id: str) -> dict:
        """Poll task status. Returns dict with at least 'status' (0=processing, 1=succeeded, 2=failed)."""

    @abstractmethod
    async def download_audio(self, audio_ref: str) -> bytes:
        """Download the generated audio bytes from the engine."""

    @abstractmethod
    async def health_check(self) -> dict:
        """Check engine availability. Returns dict with 'healthy' bool and optional info."""

    async def close(self):
        """Cleanup resources."""
