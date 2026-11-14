from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0113"
down_revision: str | None = "0112"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("clinical_note_ciphertext", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("cases", "clinical_note_ciphertext")
