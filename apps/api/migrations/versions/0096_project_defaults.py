from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0096"
down_revision: str | None = "0095"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects", sa.Column("blinded", sa.Boolean, nullable=False, server_default=sa.true())
    )
    op.add_column(
        "projects",
        sa.Column("ai_hidden_first_read", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "projects",
        sa.Column(
            "study_template_id",
            sa.Uuid(),
            sa.ForeignKey(
                "study_templates.id", name="fk_projects_study_template_id_study_templates"
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("match_iou", sa.Float, nullable=False, server_default="0.5"),
    )
    op.add_column(
        "projects",
        sa.Column("match_distance_um", sa.Float, nullable=False, server_default="4"),
    )
    op.create_check_constraint("match_iou", "projects", "match_iou > 0 AND match_iou <= 1")
    op.create_check_constraint(
        "match_distance_um", "projects", "match_distance_um > 0 AND match_distance_um <= 50"
    )


def downgrade() -> None:
    op.drop_constraint("match_distance_um", "projects", type_="check")
    op.drop_constraint("match_iou", "projects", type_="check")
    op.drop_column("projects", "match_distance_um")
    op.drop_column("projects", "match_iou")
    op.drop_column("projects", "study_template_id")
    op.drop_column("projects", "ai_hidden_first_read")
    op.drop_column("projects", "blinded")
