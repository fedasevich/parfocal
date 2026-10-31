import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import enable_tenant_isolation, track_updated_at

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "uploads",
        sa.Column("id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_by_service_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("service_accounts.id"),
            nullable=True,
        ),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("last_modified_ms", sa.BigInteger, nullable=True),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("storage_upload_id", sa.String(1024), nullable=False),
        sa.Column("part_bytes", sa.BigInteger, nullable=False),
        sa.Column("part_count", sa.Integer, nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("etag", sa.String(80), nullable=True),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column(
            "last_activity_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("object_key"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
        sa.CheckConstraint("status IN ('open', 'completed', 'aborted', 'expired')", name="status"),
        sa.CheckConstraint("size_bytes > 0", name="size_bytes"),
        sa.CheckConstraint("part_bytes >= 5242880", name="part_bytes"),
        sa.CheckConstraint("part_count BETWEEN 1 AND 10000", name="part_count"),
        sa.CheckConstraint("(status = 'open') = (closed_at IS NULL)", name="closed"),
        sa.CheckConstraint(
            "(created_by_user_id IS NULL) <> (created_by_service_id IS NULL)", name="created_by"
        ),
        sa.CheckConstraint("(status = 'completed') = (job_id IS NOT NULL)", name="completed_job"),
    )
    op.create_index("ix_uploads_tenant_id", "uploads", ["tenant_id"])
    op.create_index("ix_uploads_project_id", "uploads", ["project_id"])
    op.create_index(
        "ix_uploads_open_by_file",
        "uploads",
        ["project_id", "file_name", "size_bytes"],
        postgresql_where=sa.text("status = 'open'"),
    )
    op.create_index(
        "ix_uploads_open_by_activity",
        "uploads",
        ["last_activity_at"],
        postgresql_where=sa.text("status = 'open'"),
    )
    for statement in [*enable_tenant_isolation("uploads"), *track_updated_at("uploads")]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("uploads")
