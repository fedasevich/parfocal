import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CASE_TABLES = ("cases", "specimens", "blocks", "slides")


def one_of(column: str, values: Sequence[str]) -> sa.CheckConstraint:
    allowed = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column} IN ({allowed})", name=column)


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


def timestamps() -> list[sa.Column[datetime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.add_column(
        "patients", sa.Column("sex", sa.String(10), nullable=False, server_default="unknown")
    )
    op.add_column("patients", sa.Column("age_years", sa.SmallInteger, nullable=True))
    op.create_check_constraint("sex", "patients", "sex IN ('male', 'female', 'other', 'unknown')")
    op.create_check_constraint("age_years", "patients", "age_years BETWEEN 0 AND 150")
    op.create_unique_constraint(None, "patients", ["id", "tenant_id"])
    op.create_table(
        "cases",
        *ids(),
        sa.Column("patient_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("accession", sa.String(40), nullable=False),
        sa.Column("priority", sa.String(10), nullable=False, server_default="routine"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column(
            "assignee_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("clinical_note", sa.LargeBinary, nullable=True),
        sa.Column("clinical_question", sa.LargeBinary, nullable=True),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        *timestamps(),
        sa.UniqueConstraint("tenant_id", "accession"),
        sa.UniqueConstraint("id", "tenant_id"),
        sa.ForeignKeyConstraint(["patient_id", "tenant_id"], ["patients.id", "patients.tenant_id"]),
        one_of("priority", ("routine", "urgent", "asap", "stat")),
        one_of("source", ("lis", "manual", "upload")),
    )
    op.create_table(
        "specimens",
        *ids(),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("letter", sa.String(2), nullable=False),
        sa.Column("type", sa.String(200), nullable=True),
        sa.Column("site", sa.String(200), nullable=True),
        sa.Column("laterality", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("procedure", sa.String(200), nullable=True),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("case_id", "letter"),
        sa.UniqueConstraint("id", "case_id", "tenant_id"),
        sa.ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
        sa.CheckConstraint("letter ~ '^[A-Z]{1,2}$'", name="letter"),
        one_of("laterality", ("left", "right", "bilateral", "not-applicable", "unknown")),
    )
    op.create_table(
        "blocks",
        *ids(),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("specimen_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("number", sa.SmallInteger, nullable=False),
        sa.Column("description", sa.String(200), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("specimen_id", "number"),
        sa.UniqueConstraint("id", "case_id"),
        sa.ForeignKeyConstraint(
            ["specimen_id", "case_id", "tenant_id"],
            ["specimens.id", "specimens.case_id", "specimens.tenant_id"],
        ),
        sa.CheckConstraint("number BETWEEN 1 AND 999", name="number"),
    )
    op.create_table(
        "slides",
        *ids(),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("block_id", sa.Uuid[uuid.UUID](), nullable=True, index=True),
        sa.Column("barcode", sa.String(100), nullable=True),
        sa.Column("stain", sa.String(60), nullable=False, server_default="H&E"),
        sa.Column("level", sa.SmallInteger, nullable=True),
        *timestamps(),
        sa.UniqueConstraint("tenant_id", "barcode"),
        sa.ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
        sa.ForeignKeyConstraint(["block_id", "case_id"], ["blocks.id", "blocks.case_id"]),
    )
    for table in CASE_TABLES:
        for statement in [
            *enable_tenant_isolation(table),
            *track_updated_at(table),
        ]:
            op.execute(statement)


def downgrade() -> None:
    for table in reversed(CASE_TABLES):
        op.execute(untrack_updated_at(table)[0])
        op.drop_table(table)
    op.drop_constraint("age_years", "patients", type_="check")
    op.drop_constraint("sex", "patients", type_="check")
    op.drop_constraint("uq_patients_id_tenant_id", "patients", type_="unique")
    op.drop_column("patients", "age_years")
    op.drop_column("patients", "sex")
