from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.preset import StylePreset
from app.schemas.preset import PresetCreate, PresetUpdate, PresetResponse

router = APIRouter(prefix="/api/presets", tags=["presets"])


@router.get("", response_model=list[PresetResponse])
async def list_presets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StylePreset)
        .where(or_(StylePreset.is_builtin == True, StylePreset.user_id == user.id))  # noqa: E712
        .order_by(StylePreset.is_builtin.desc(), StylePreset.name)
    )
    return result.scalars().all()


@router.post("", response_model=PresetResponse, status_code=status.HTTP_201_CREATED)
async def create_preset(
    req: PresetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    preset = StylePreset(
        name=req.name,
        description=req.description,
        acestep_caption=req.acestep_caption,
        suno_tags=req.suno_tags,
        category_tags=req.category_tags,
        cover_art_emoji=req.cover_art_emoji,
        is_builtin=False,
        user_id=user.id,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.put("/{preset_id}", response_model=PresetResponse)
async def update_preset(
    preset_id: UUID,
    req: PresetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StylePreset).where(StylePreset.id == preset_id, StylePreset.user_id == user.id)
    )
    preset = result.scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(preset, field, value)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(
    preset_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StylePreset).where(StylePreset.id == preset_id, StylePreset.user_id == user.id, StylePreset.is_builtin == False)  # noqa: E712
    )
    preset = result.scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found or is builtin")
    await db.delete(preset)
    await db.commit()
