"""songs.source_audio_path -> source_audio_key (relative storage key)

Revision ID: 7c3e2a9d4f10
Revises: 5b1d0c7e9a42
Create Date: 2026-10-31 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7c3e2a9d4f10'
down_revision: Union[str, None] = '5b1d0c7e9a42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('songs', 'source_audio_path', new_column_name='source_audio_key')
    # Legacy values are absolute paths ending in .../uploads/<file>; anything else cannot be trusted.
    op.execute(
        "UPDATE songs SET source_audio_key = substring(source_audio_key from '(uploads/[^/]+)$') "
        "WHERE source_audio_key IS NOT NULL"
    )


def downgrade() -> None:
    op.alter_column('songs', 'source_audio_key', new_column_name='source_audio_path')
