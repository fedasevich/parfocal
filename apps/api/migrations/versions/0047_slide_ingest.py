import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FACTS = (
    ("format", sa.String(30)),
    ("variant", sa.String(30)),
    ("reader", sa.String(20)),
    ("width", sa.Integer()),
    ("height", sa.Integer()),
    ("level_count", sa.SmallInteger()),
    ("mpp_x", sa.Float()),
    ("mpp_y", sa.Float()),
    ("objective_power", sa.Float()),
    ("file_bytes", sa.BigInteger()),
    ("sha256", sa.String(64)),
    ("original_key", sa.String(300)),
    ("published_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.create_unique_constraint("uq_uploads_id_project_id", "uploads", ["id", "project_id"])
    op.add_column("slides", sa.Column("upload_id", sa.Uuid[uuid.UUID](), nullable=True))
    for name, kind in FACTS:
        op.add_column("slides", sa.Column(name, kind, nullable=True))
    op.add_column(
        "slides",
        sa.Column("notices", ARRAY(sa.String(40)), nullable=False, server_default="{}"),
    )
    op.add_column(
        "slides",
        sa.Column("restricted_images", ARRAY(sa.String(10)), nullable=False, server_default="{}"),
    )
    op.create_unique_constraint("uq_slides_upload_id", "slides", ["upload_id"])
    op.create_foreign_key(
        "fk_slides_upload_id_project_id_uploads",
        "slides",
        "uploads",
        ["upload_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_check_constraint(
        "uploaded_file", "slides", "upload_id IS NULL OR original_key IS NOT NULL"
    )
    op.drop_constraint("uq_slides_case_id_label", "slides", type_="unique")
    op.create_index(
        "ix_slides_case_id_label",
        "slides",
        ["case_id", "label"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index("ix_slides_project_id_label", "slides")
    op.create_index(
        "ix_slides_project_id_label",
        "slides",
        ["project_id", "label"],
        unique=True,
        postgresql_where=sa.text("case_id IS NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_slides_project_id_label", "slides")
    op.create_index(
        "ix_slides_project_id_label",
        "slides",
        ["project_id", "label"],
        unique=True,
        postgresql_where=sa.text("case_id IS NULL"),
    )
    op.drop_index("ix_slides_case_id_label", "slides")
    op.create_unique_constraint("uq_slides_case_id_label", "slides", ["case_id", "label"])
    op.drop_constraint("uploaded_file", "slides", type_="check")
    op.drop_constraint("fk_slides_upload_id_project_id_uploads", "slides", type_="foreignkey")
    op.drop_constraint("uq_slides_upload_id", "slides", type_="unique")
    for name in ("restricted_images", "notices", *(name for name, _ in reversed(FACTS))):
        op.drop_column("slides", name)
    op.drop_column("slides", "upload_id")
    op.drop_constraint("uq_uploads_id_project_id", "uploads", type_="unique")
