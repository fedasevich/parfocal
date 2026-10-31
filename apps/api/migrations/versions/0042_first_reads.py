from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEEP_FIRST_READ = """
CREATE FUNCTION parfocal_first_read_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.first_read_at IS NOT NULL
     AND (NEW.first_read_at, NEW.first_read) IS DISTINCT FROM (OLD.first_read_at, OLD.first_read)
  THEN
    RAISE EXCEPTION 'the first read of % on slide % is kept as it was recorded',
      OLD.task_id, OLD.slide_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$
"""


def upgrade() -> None:
    op.add_column(
        "review_assignments",
        sa.Column("first_read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "review_assignments",
        sa.Column("first_read", postgresql.JSONB(), nullable=True),
    )
    op.create_check_constraint(
        "first_read_pair", "review_assignments", "(first_read_at IS NULL) = (first_read IS NULL)"
    )
    op.execute(KEEP_FIRST_READ)
    op.execute(
        "CREATE TRIGGER review_assignments_first_read_kept BEFORE UPDATE ON review_assignments "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_first_read_kept()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER review_assignments_first_read_kept ON review_assignments")
    op.execute("DROP FUNCTION parfocal_first_read_kept()")
    op.drop_constraint("first_read_pair", "review_assignments", type_="check")
    op.drop_column("review_assignments", "first_read")
    op.drop_column("review_assignments", "first_read_at")
