from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0090"
down_revision: str | None = "0089"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCOPES = ("all-regions", "random-cells", "cells-below-score", "inside-rois", "unsure-zones")
SLIDE_KIND_KEY = "fk_review_task_slides_task_id_kind_review_tasks"
ANNOTATE_TASKS = "SELECT id FROM review_tasks WHERE kind = 'annotate'"


def scope_check(values: Sequence[str]) -> str:
    return "scope IN (" + ", ".join(f"'{value}'" for value in values) + ")"


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("kind", sa.String(10), nullable=False, server_default="review"),
    )
    op.add_column("review_tasks", sa.Column("class_snapshot", JSONB, nullable=True))
    op.create_check_constraint("kind", "review_tasks", "kind IN ('review', 'annotate')")
    op.create_check_constraint(
        "class_snapshot", "review_tasks", "(kind = 'annotate') = (class_snapshot IS NOT NULL)"
    )
    op.drop_constraint("scope", "review_tasks", type_="check")
    op.create_check_constraint("scope", "review_tasks", scope_check([*SCOPES, "whole-slide"]))
    op.create_check_constraint(
        "whole_slide", "review_tasks", "(kind = 'annotate') = (scope = 'whole-slide')"
    )
    op.create_unique_constraint("uq_review_tasks_id_kind", "review_tasks", ["id", "kind"])
    op.add_column(
        "review_task_slides",
        sa.Column("kind", sa.String(10), nullable=False, server_default="review"),
    )
    op.create_foreign_key(
        SLIDE_KIND_KEY, "review_task_slides", "review_tasks", ["task_id", "kind"], ["id", "kind"]
    )
    op.alter_column("review_task_slides", "result_set_id", nullable=True)
    op.create_check_constraint(
        "result_set", "review_task_slides", "kind = 'annotate' OR result_set_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(f"UPDATE annotations SET task_id = NULL WHERE task_id IN ({ANNOTATE_TASKS})")
    op.execute(f"DELETE FROM review_assignments WHERE task_id IN ({ANNOTATE_TASKS})")
    op.execute(f"DELETE FROM review_task_slides WHERE task_id IN ({ANNOTATE_TASKS})")
    op.execute("DELETE FROM review_tasks WHERE kind = 'annotate'")
    op.drop_constraint("result_set", "review_task_slides", type_="check")
    op.alter_column("review_task_slides", "result_set_id", nullable=False)
    op.drop_constraint(SLIDE_KIND_KEY, "review_task_slides", type_="foreignkey")
    op.drop_column("review_task_slides", "kind")
    op.drop_constraint("uq_review_tasks_id_kind", "review_tasks", type_="unique")
    op.drop_constraint("whole_slide", "review_tasks", type_="check")
    op.drop_constraint("scope", "review_tasks", type_="check")
    op.create_check_constraint("scope", "review_tasks", scope_check(SCOPES))
    op.drop_constraint("class_snapshot", "review_tasks", type_="check")
    op.drop_constraint("kind", "review_tasks", type_="check")
    op.drop_column("review_tasks", "class_snapshot")
    op.drop_column("review_tasks", "kind")
