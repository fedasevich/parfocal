import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("result_format", sa.String(20)),
    ("slide_id", sa.Uuid[uuid.UUID]()),
    ("slide_upload_id", sa.Uuid[uuid.UUID]()),
    ("pairing_rule", sa.String(30)),
    ("pairing_certainty", sa.String(10)),
    ("result_set_id", sa.Uuid[uuid.UUID]()),
)
CHECKS = (
    ("kind", "kind IN ('slide', 'result')"),
    ("result_format", "result_format IN ('geojson', 'parfocal-json', 'csv')"),
    (
        "pairing_rule",
        "pairing_rule IN ('next-to-slide', 'folder-named-like-slide', 'file-name', "
        "'embedded-id', 'picked')",
    ),
    ("pairing_certainty", "pairing_certainty IN ('sure', 'likely')"),
    (
        "slide_fields",
        "kind = 'result' OR (result_format IS NULL AND slide_id IS NULL "
        "AND slide_upload_id IS NULL AND pairing_rule IS NULL AND result_set_id IS NULL)",
    ),
    ("pairing", "(pairing_rule IS NULL) = (pairing_certainty IS NULL)"),
    ("paired_with", "pairing_rule IS NULL OR slide_id IS NOT NULL OR slide_upload_id IS NOT NULL"),
    ("imported_on_slide", "result_set_id IS NULL OR slide_id IS NOT NULL"),
    ("not_itself", "slide_upload_id IS NULL OR slide_upload_id <> id"),
)
FOREIGN_KEYS = (
    ("fk_uploads_slide_id_project_id_slides", "slides", ["slide_id", "project_id"]),
    (
        "fk_uploads_slide_upload_id_project_id_uploads",
        "uploads",
        ["slide_upload_id", "project_id"],
    ),
    (
        "fk_uploads_result_set_id_project_id_result_sets",
        "result_sets",
        ["result_set_id", "project_id"],
    ),
)


def upgrade() -> None:
    op.add_column(
        "uploads", sa.Column("kind", sa.String(10), nullable=False, server_default="slide")
    )
    for name, kind in COLUMNS:
        op.add_column("uploads", sa.Column(name, kind, nullable=True))
    op.create_unique_constraint("uq_uploads_result_set_id", "uploads", ["result_set_id"])
    for name, table, columns in FOREIGN_KEYS:
        op.create_foreign_key(name, "uploads", table, columns, ["id", "project_id"])
    for name, condition in CHECKS:
        op.create_check_constraint(name, "uploads", condition)
    op.drop_constraint("completed_job", "uploads", type_="check")
    op.create_check_constraint(
        "completed_job",
        "uploads",
        "(job_id IS NULL OR status = 'completed') "
        "AND (kind = 'result' OR status <> 'completed' OR job_id IS NOT NULL)",
    )
    op.create_index(
        "ix_uploads_slide_upload_id",
        "uploads",
        ["slide_upload_id"],
        postgresql_where=sa.text("slide_upload_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_uploads_slide_upload_id", "uploads")
    op.drop_constraint("completed_job", "uploads", type_="check")
    op.create_check_constraint(
        "completed_job", "uploads", "(status = 'completed') = (job_id IS NOT NULL)"
    )
    for name, _ in reversed(CHECKS):
        op.drop_constraint(name, "uploads", type_="check")
    for name, _, _ in reversed(FOREIGN_KEYS):
        op.drop_constraint(name, "uploads", type_="foreignkey")
    op.drop_constraint("uq_uploads_result_set_id", "uploads", type_="unique")
    for name, _ in reversed(COLUMNS):
        op.drop_column("uploads", name)
    op.drop_column("uploads", "kind")
