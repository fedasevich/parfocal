import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0095"
down_revision: str | None = "0094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TEMPLATES = "'sentinel-node', 'lymph-node-excision'"
CATEGORIES = "'none', 'itc', 'micro', 'macro'"
TABLES = ("clinical_reports", "clinical_deposits", "clinical_report_versions")


def ids() -> list[sa.Column[uuid.UUID]]:
    return [
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
    ]


def person(name: str) -> sa.Column[uuid.UUID]:
    return sa.Column(name, sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True)


def timestamps() -> list[sa.Column[datetime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def report_id() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "report_id",
        sa.Uuid[uuid.UUID](),
        sa.ForeignKey("clinical_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "clinical_template", sa.String(30), nullable=False, server_default="sentinel-node"
        ),
    )
    op.create_check_constraint(
        "clinical_template", "projects", f"clinical_template IN ({TEMPLATES})"
    )
    op.create_table(
        "clinical_reports",
        *ids(),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False, unique=True),
        sa.Column("template", sa.String(30), nullable=False),
        sa.Column("template_version", sa.SmallInteger, nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("specimen", sa.String(200), nullable=True),
        sa.Column("category", sa.String(10), nullable=True),
        sa.Column("confirmed_against", sa.String(10), nullable=True),
        sa.Column("nodes_examined", sa.SmallInteger, nullable=True),
        sa.Column("extranodal", sa.String(10), nullable=True),
        sa.Column("diagnosis", sa.String(2000), nullable=True),
        sa.Column("microscopic", sa.String(5000), nullable=True),
        sa.Column("comment", sa.String(2000), nullable=True),
        person("cosigner_user_id"),
        person("sent_by_user_id"),
        sa.Column("return_note", sa.String(300), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="0"),
        person("created_by_user_id"),
        *timestamps(),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
        sa.CheckConstraint(f"template IN ({TEMPLATES})", name="template"),
        sa.CheckConstraint(
            "state IN ('draft', 'sent', 'returned', 'signed', 'amended')", name="state"
        ),
        sa.CheckConstraint(f"category IN ({CATEGORIES})", name="category"),
        sa.CheckConstraint(f"confirmed_against IN ({CATEGORIES})", name="confirmed_against"),
        sa.CheckConstraint("extranodal IN ('present', 'absent', 'na')", name="extranodal"),
        sa.CheckConstraint("template_version >= 1", name="template_version"),
        sa.CheckConstraint("nodes_examined IS NULL OR nodes_examined >= 0", name="nodes_examined"),
        sa.CheckConstraint("version >= 0", name="version"),
    )
    op.create_table(
        "clinical_deposits",
        *ids(),
        report_id(),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("slides.id"), nullable=False),
        sa.Column("object_id", sa.String(40), nullable=True),
        sa.Column("size_mm", sa.Float[float](), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        *timestamps(),
        sa.CheckConstraint("size_mm IS NULL OR size_mm > 0", name="size_mm"),
        sa.CheckConstraint("object_id IS NOT NULL OR size_mm IS NOT NULL", name="source"),
    )
    op.create_table(
        "clinical_report_versions",
        *ids(),
        report_id(),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("reason", sa.String(300), nullable=True),
        person("signed_by_user_id"),
        person("reported_by_user_id"),
        sa.Column(
            "signed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("report_id", "number"),
        sa.CheckConstraint("number >= 1", name="number"),
        sa.CheckConstraint("(number = 1) = (reason IS NULL)", name="reason"),
    )
    for table in TABLES:
        for statement in enable_tenant_isolation(table):
            op.execute(statement)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
    op.drop_constraint("clinical_template", "projects", type_="check")
    op.drop_column("projects", "clinical_template")
