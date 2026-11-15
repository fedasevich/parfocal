from collections.abc import Sequence
from pathlib import Path

from alembic import context, op

revision: str = "0115"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BASELINE = Path(__file__).resolve().parents[1] / "baseline.sql"
STATEMENT_BREAK = "\n--\n"
DUMPED_APP_ROLE = "parfocal_app"


def app_role() -> str:
    return str(context.config.attributes.get("app_role", DUMPED_APP_ROLE))


def default_privileges(action: str) -> list[str]:
    role = app_role()
    towards = "TO" if action == "GRANT" else "FROM"
    return [
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public {action} SELECT, INSERT, UPDATE, DELETE "
        f"ON TABLES {towards} {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public {action} USAGE, SELECT "
        f"ON SEQUENCES {towards} {role}",
    ]


def upgrade() -> None:
    connection = op.get_bind()
    connection.exec_driver_sql("SET LOCAL check_function_bodies = false")
    role = app_role()
    for statement in BASELINE.read_text().split(STATEMENT_BREAK):
        connection.exec_driver_sql(statement.replace(DUMPED_APP_ROLE, role))
    connection.exec_driver_sql("SET LOCAL check_function_bodies = true")
    for statement in default_privileges("GRANT"):
        connection.exec_driver_sql(statement)


def downgrade() -> None:
    connection = op.get_bind()
    for statement in default_privileges("REVOKE"):
        connection.exec_driver_sql(statement)
    connection.exec_driver_sql(
        """
DO $$
DECLARE
  found record;
BEGIN
  FOR found IN
    SELECT c.oid::regclass AS name FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND c.relname <> 'alembic_version'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %s CASCADE', found.name);
  END LOOP;
  FOR found IN
    SELECT p.oid::regprocedure AS name FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', found.name);
  END LOOP;
END
$$
"""
    )
    connection.exec_driver_sql("DROP EXTENSION IF EXISTS postgis")
