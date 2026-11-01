"""drop style_presets.suno_tags

Revision ID: 5b1d0c7e9a42
Revises: 31c82b7a834b
Create Date: 2026-10-31 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5b1d0c7e9a42'
down_revision: Union[str, None] = '31c82b7a834b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('style_presets', 'suno_tags')


def downgrade() -> None:
    op.add_column('style_presets', sa.Column('suno_tags', sa.Text(), nullable=True))
