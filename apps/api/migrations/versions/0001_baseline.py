from collections.abc import Sequence

from alembic import context, op

from parfocal_common.schema_sql import (
    DROP_TOUCH_UPDATED_AT_FUNCTION,
    TOUCH_UPDATED_AT_FUNCTION,
    grant_app_role,
    revoke_app_role,
)

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute(TOUCH_UPDATED_AT_FUNCTION)
    for statement in grant_app_role(app_role()):
        op.execute(statement)


def downgrade() -> None:
    for statement in revoke_app_role(app_role()):
        op.execute(statement)
    op.execute(DROP_TOUCH_UPDATED_AT_FUNCTION)
    op.execute("DROP EXTENSION IF EXISTS postgis")
