from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0097"
down_revision: str | None = "0096"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("clinical_reports", sa.Column("sent_content", JSONB, nullable=True))
    op.add_column(
        "clinical_reports", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("clinical_reports", "sent_at")
    op.drop_column("clinical_reports", "sent_content")
