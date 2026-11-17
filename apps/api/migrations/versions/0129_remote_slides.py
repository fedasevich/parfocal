from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0129"
down_revision: str | None = "0128"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "slides"
SOURCE_KEY = "fk_slides_source_id_import_sources"
SOURCE_INDEX = "ix_slides_source_id"
STORAGE_CHECK = "ck_slides_storage"
PATH_CHECK = "ck_slides_remote_path"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("storage", sa.String(10), nullable=False, server_default="uploaded"),
    )
    op.add_column(TABLE, sa.Column("source_id", sa.Uuid()))
    op.add_column(TABLE, sa.Column("remote_path", sa.String(1024)))
    op.add_column(TABLE, sa.Column("remote_etag", sa.String(200)))
    op.add_column(
        TABLE,
        sa.Column("remote_failures", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.add_column(TABLE, sa.Column("remote_failing_since", sa.DateTime(timezone=True)))
    op.add_column(TABLE, sa.Column("remote_read_at", sa.DateTime(timezone=True)))
    op.create_foreign_key(
        SOURCE_KEY, TABLE, "import_sources", ["source_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index(SOURCE_INDEX, TABLE, ["source_id"])
    op.create_check_constraint(STORAGE_CHECK, TABLE, "storage IN ('uploaded', 'remote')")
    op.create_check_constraint(PATH_CHECK, TABLE, "storage <> 'remote' OR remote_path IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint(PATH_CHECK, TABLE, type_="check")
    op.drop_constraint(STORAGE_CHECK, TABLE, type_="check")
    op.drop_index(SOURCE_INDEX, TABLE)
    op.drop_constraint(SOURCE_KEY, TABLE, type_="foreignkey")
    for column in (
        "remote_read_at",
        "remote_failing_since",
        "remote_failures",
        "remote_etag",
        "remote_path",
        "source_id",
        "storage",
    ):
        op.drop_column(TABLE, column)
