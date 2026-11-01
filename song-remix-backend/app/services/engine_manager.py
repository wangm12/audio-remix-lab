from app.config import settings
from app.engines.base import AbstractEngine
from app.engines.acestep_engine import ACEStepEngine


class EngineManager:
    def __init__(self):
        self._engines: dict[str, AbstractEngine] = {}

    def register(self, engine: AbstractEngine):
        self._engines[engine.name] = engine

    def get(self, name: str) -> AbstractEngine:
        engine = self._engines.get(name)
        if engine is None:
            raise ValueError(f"Engine '{name}' is not registered or not enabled")
        return engine

    def available_engines(self) -> list[str]:
        return list(self._engines.keys())

    async def health_check_all(self) -> list[dict]:
        results = []
        for engine in self._engines.values():
            results.append(await engine.health_check())
        return results

    async def close_all(self):
        for engine in self._engines.values():
            await engine.close()


engine_manager = EngineManager()


def init_engines():
    if settings.ACESTEP_ENABLED:
        engine_manager.register(ACEStepEngine())
