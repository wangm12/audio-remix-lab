from fastapi import APIRouter

from app.services.engine_manager import engine_manager

router = APIRouter(prefix="/api/engines", tags=["engines"])


@router.get("/status")
async def engine_status():
    results = await engine_manager.health_check_all()
    available = engine_manager.available_engines()
    return {
        "available_engines": available,
        "health": results,
    }
