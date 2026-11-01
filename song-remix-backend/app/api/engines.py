from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.models.user import User
from app.services.engine_manager import engine_manager

router = APIRouter(prefix="/api/engines", tags=["engines"])


@router.get("/status")
async def engine_status(user: User = Depends(get_current_user)):
    results = await engine_manager.health_check_all()
    available = engine_manager.available_engines()
    return {
        "available_engines": available,
        "health": results,
    }
