import json
import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0085"
down_revision: str | None = "0084"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUILT_IN_DISPLAY = {
    "segmentation": {"width": 1},
    "cell-typing": {"draw_as": "dots", "id_labels": False},
    "reader-study": {"confidence": "hidden"},
}


def stamps() -> list[sa.Column[datetime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("display", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column("verdicts", sa.Column("preset", sa.String(40), nullable=True))
    op.create_table(
        "display_presets",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("review_tasks.id"), nullable=True),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("settings", JSONB, nullable=False),
        *stamps(),
    )
    op.create_index(
        "ix_display_presets_tenant_id_user_id_name",
        "display_presets",
        ["tenant_id", "user_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "display_choices",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column(
            "task_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("review_tasks.id"), primary_key=True
        ),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column(
            "preset_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("display_presets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("settings", JSONB, nullable=False),
        *stamps(),
    )
    for table in ("display_presets", "display_choices"):
        for statement in [*enable_tenant_isolation(table), *track_updated_at(table)]:
            op.execute(statement)
    for key, display in BUILT_IN_DISPLAY.items():
        op.execute(
            sa.text(
                "UPDATE study_template_versions v SET presets = jsonb_set(v.presets, "
                "'{display}', CAST(:display AS jsonb)) FROM study_templates t "
                "WHERE t.id = v.template_id AND t.built_in = :key AND v.version = 1 "
                "AND NOT v.presets ? 'display'"
            ).bindparams(display=json.dumps(display), key=key)
        )


def downgrade() -> None:
    op.execute(
        "UPDATE study_template_versions SET presets = presets - 'display' WHERE presets ? 'display'"
    )
    for table in ("display_choices", "display_presets"):
        op.execute(untrack_updated_at(table)[0])
        op.drop_table(table)
    op.drop_column("verdicts", "preset")
    op.drop_column("review_tasks", "display")
