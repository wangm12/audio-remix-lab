from sqlalchemy import func, select

import seed_presets
from app.database import Base
from app.models.preset import StylePreset


async def test_seed_is_idempotent_and_never_calls_create_all(monkeypatch, db):
    def forbidden(*args, **kwargs):
        raise AssertionError("seed_presets must not call create_all; the schema comes from alembic")

    monkeypatch.setattr(Base.metadata, "create_all", forbidden)

    assert await seed_presets.seed() == len(seed_presets.BUILTIN_PRESETS)
    assert await seed_presets.seed() == 0
    count = await db.scalar(
        select(func.count()).select_from(StylePreset).where(StylePreset.is_builtin.is_(True))
    )
    assert count == len(seed_presets.BUILTIN_PRESETS) == 8


def test_builtin_presets_have_no_suno_tags():
    assert all("suno_tags" not in preset for preset in seed_presets.BUILTIN_PRESETS)
