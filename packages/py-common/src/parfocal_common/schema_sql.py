from parfocal_common.db import CURRENT_TENANT

TOUCH_UPDATED_AT_FUNCTION = """
CREATE FUNCTION parfocal_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$
"""

DROP_TOUCH_UPDATED_AT_FUNCTION = "DROP FUNCTION parfocal_touch_updated_at()"

TENANT_TABLES_WITHOUT_ISOLATION = """
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE c.relkind = 'r'
  AND n.nspname = current_schema()
  AND NOT (
    c.relrowsecurity
    AND c.relforcerowsecurity
    AND EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
    )
  )
ORDER BY c.relname
"""


def enable_tenant_isolation(table: str) -> list[str]:
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = {CURRENT_TENANT}) WITH CHECK (tenant_id = {CURRENT_TENANT})",
    ]


def disable_tenant_isolation(table: str) -> list[str]:
    return [
        f"DROP POLICY tenant_isolation ON {table}",
        f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY",
    ]


def track_updated_at(table: str) -> list[str]:
    return [
        f"CREATE TRIGGER {table}_touch_updated_at BEFORE UPDATE ON {table} "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_touch_updated_at()"
    ]


def untrack_updated_at(table: str) -> list[str]:
    return [f"DROP TRIGGER {table}_touch_updated_at ON {table}"]


def grant_app_role(role: str) -> list[str]:
    return [
        f"GRANT USAGE ON SCHEMA public TO {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role}",
    ]


def revoke_app_role(role: str) -> list[str]:
    return [
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM {role}",
    ]
