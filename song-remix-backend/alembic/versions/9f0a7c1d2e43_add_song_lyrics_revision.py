"""Add a durable compare-and-set revision for Song lyrics.

Revision ID: 9f0a7c1d2e43
Revises: 7c3e2a9d4f10
Create Date: 2026-11-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9f0a7c1d2e43"
down_revision: Union[str, None] = "7c3e2a9d4f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add revision zero to all existing Songs without rewriting their content."""
    op.add_column(
        "songs",
        sa.Column("lyrics_revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    """Remove the revision column; only safe on an isolated scratch database."""
    op.drop_column("songs", "lyrics_revision")
