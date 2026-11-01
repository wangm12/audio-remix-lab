"""Seed the database with built-in R&B style presets. Run `alembic upgrade head` first."""
import asyncio

from sqlalchemy import select

from app.database import async_session
from app.models.preset import StylePreset

BUILTIN_PRESETS = [
    {
        "name": "Smooth R&B",
        "description": "Classic smooth R&B with warm electric piano and laid-back groove",
        "acestep_caption": "smooth R&B track, soulful vocals, electric piano, mellow synths, laid-back groove, warm mix",
        "category_tags": ["r&b", "smooth"],
        "cover_art_emoji": "🎹",
    },
    {
        "name": "Neo-Soul",
        "description": "Jazz-influenced neo-soul with Rhodes piano and organic drums",
        "acestep_caption": "neo-soul ballad, breathy falsetto, Rhodes piano, jazzy chords, organic drums, analog warmth",
        "category_tags": ["r&b", "neo-soul", "jazz"],
        "cover_art_emoji": "🎷",
    },
    {
        "name": "90s R&B",
        "description": "Retro 90s R&B with new jack swing influence and vocal harmonies",
        "acestep_caption": "90s R&B, new jack swing influence, tight snares, punchy bass, vocal harmonies, polished production",
        "category_tags": ["r&b", "90s", "retro"],
        "cover_art_emoji": "📼",
    },
    {
        "name": "Bedroom R&B",
        "description": "Intimate lo-fi bedroom R&B with dreamy atmosphere",
        "acestep_caption": "lo-fi bedroom R&B, intimate whisper vocals, tape hiss, detuned synths, slow tempo, dreamy atmosphere",
        "category_tags": ["r&b", "lo-fi", "bedroom"],
        "cover_art_emoji": "🌙",
    },
    {
        "name": "R&B Ballad",
        "description": "Emotional R&B ballad with orchestral strings and cinematic crescendo",
        "acestep_caption": "emotional R&B ballad, powerful vocal runs, orchestral strings, piano-driven, cinematic crescendo",
        "category_tags": ["r&b", "ballad"],
        "cover_art_emoji": "🎻",
    },
    {
        "name": "Trap Soul",
        "description": "Modern trap soul with 808 bass and auto-tune vocals",
        "acestep_caption": "trap soul, 808 bass, hi-hat rolls, auto-tune vocals, dark atmospheric pads, modern production",
        "category_tags": ["r&b", "trap", "modern"],
        "cover_art_emoji": "🔊",
    },
    {
        "name": "Bossa Nova Chill",
        "description": "Bossa nova meets R&B with nylon guitar and tropical vibes",
        "acestep_caption": "bossa nova meets R&B, nylon guitar, soft percussion, breezy vocals, tropical undertones, relaxed vibe",
        "category_tags": ["r&b", "bossa-nova", "chill"],
        "cover_art_emoji": "🌴",
    },
    {
        "name": "Jazz Lounge",
        "description": "Sophisticated jazz lounge R&B with smoky vocals",
        "acestep_caption": "jazz lounge R&B, upright bass, brushed drums, smoky vocals, dim-lit atmosphere, sophisticated chords",
        "category_tags": ["r&b", "jazz", "lounge"],
        "cover_art_emoji": "🍸",
    },
]


async def seed() -> int:
    created = 0
    async with async_session() as db:
        for preset_data in BUILTIN_PRESETS:
            existing = await db.execute(
                select(StylePreset.id).where(
                    StylePreset.name == preset_data["name"],
                    StylePreset.is_builtin.is_(True),
                )
            )
            if existing.scalar_one_or_none() is None:
                db.add(StylePreset(is_builtin=True, **preset_data))
                created += 1
        await db.commit()
    return created


if __name__ == "__main__":
    count = asyncio.run(seed())
    print(f"Seeded {count} new built-in presets ({len(BUILTIN_PRESETS)} total)")
