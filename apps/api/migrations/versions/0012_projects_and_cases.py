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

CASE_TABLES = ("projects", "cases", "specimens", "blocks", "slides")


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
        "projects",
        *ids(),
        sa.Column("number", sa.SmallInteger, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("privacy_mode", sa.String(20), nullable=False, server_default="de-identified"),
        *timestamps(),
        sa.UniqueConstraint("tenant_id", "number"),
        sa.UniqueConstraint("id", "tenant_id"),
        sa.UniqueConstraint("id", "privacy_mode"),
        sa.CheckConstraint("number BETWEEN 1 AND 9999", name="number"),
        one_of("privacy_mode", ("de-identified", "clinical")),
    )
    op.create_table(
        "project_members",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.PrimaryKeyConstraint("project_id", "user_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        one_of("role", ("owner", "reviewer", "viewer")),
    )
    op.create_index("ix_project_members_user_id", "project_members", ["user_id"])
    op.add_column("patients", sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False))
    op.add_column(
        "patients",
        sa.Column("privacy_mode", sa.String(20), nullable=False, server_default="clinical"),
    )
    op.create_index("ix_patients_project_id", "patients", ["project_id"])
    op.create_check_constraint("clinical_only", "patients", "privacy_mode = 'clinical'")
    op.create_foreign_key(
        None, "patients", "projects", ["project_id", "tenant_id"], ["id", "tenant_id"]
    )
    op.create_foreign_key(
        None, "patients", "projects", ["project_id", "privacy_mode"], ["id", "privacy_mode"]
    )
    op.drop_constraint("uq_patients_tenant_id_mrn_index", "patients", type_="unique")
    op.create_unique_constraint(None, "patients", ["project_id", "mrn_index"])
    op.create_unique_constraint(None, "patients", ["id", "project_id"])
    op.drop_index("ix_patients_birth_date_index", "patients")
    op.create_index("ix_patients_birth_date_index", "patients", ["project_id", "birth_date_index"])
    op.create_table(
        "cases",
        *ids(),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("patient_id", sa.Uuid[uuid.UUID](), nullable=True, index=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        *timestamps(),
        sa.UniqueConstraint("project_id", "label"),
        sa.UniqueConstraint("id", "tenant_id"),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["patient_id", "project_id"], ["patients.id", "patients.project_id"]
        ),
        one_of("source", ("manual", "upload")),
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
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=True, index=True),
        sa.Column("block_id", sa.Uuid[uuid.UUID](), nullable=True, index=True),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("barcode", sa.String(100), nullable=True),
        sa.Column("stain", sa.String(60), nullable=False, server_default="H&E"),
        sa.Column("level", sa.SmallInteger, nullable=True),
        *timestamps(),
        sa.UniqueConstraint("project_id", "barcode"),
        sa.UniqueConstraint("case_id", "label"),
        sa.Index(
            "ix_slides_project_id_label",
            "project_id",
            "label",
            unique=True,
            postgresql_where=sa.text("case_id IS NULL"),
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
        sa.ForeignKeyConstraint(["block_id", "case_id"], ["blocks.id", "blocks.case_id"]),
        sa.CheckConstraint("block_id IS NULL OR case_id IS NOT NULL", name="block_in_case"),
    )
    for statement in enable_tenant_isolation("project_members"):
        op.execute(statement)
    for table in CASE_TABLES:
        for statement in [
            *enable_tenant_isolation(table),
            *track_updated_at(table),
        ]:
            op.execute(statement)


def unlink_patients() -> None:
    op.drop_index("ix_patients_birth_date_index", "patients")
    op.create_index("ix_patients_birth_date_index", "patients", ["tenant_id", "birth_date_index"])
    op.drop_constraint("uq_patients_id_project_id", "patients", type_="unique")
    op.drop_constraint("uq_patients_project_id_mrn_index", "patients", type_="unique")
    op.create_unique_constraint(None, "patients", ["tenant_id", "mrn_index"])
    op.drop_constraint(
        "fk_patients_project_id_privacy_mode_projects", "patients", type_="foreignkey"
    )
    op.drop_constraint("fk_patients_project_id_tenant_id_projects", "patients", type_="foreignkey")
    op.drop_constraint("clinical_only", "patients", type_="check")
    op.drop_index("ix_patients_project_id", "patients")
    op.drop_column("patients", "privacy_mode")
    op.drop_column("patients", "project_id")


def downgrade() -> None:
    for table in reversed(CASE_TABLES):
        op.execute(untrack_updated_at(table)[0])
        if table == "projects":
            op.drop_table("project_members")
            unlink_patients()
        op.drop_table(table)
    op.drop_constraint("age_years", "patients", type_="check")
    op.drop_constraint("sex", "patients", type_="check")
    op.drop_constraint("uq_patients_id_tenant_id", "patients", type_="unique")
    op.drop_column("patients", "age_years")
    op.drop_column("patients", "sex")
