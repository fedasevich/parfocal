from parfocal_common.db import AUTH_SERVICE, CURRENT_TENANT, PLATFORM_OPERATOR

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

TABLES_WITHOUT_ROW_SECURITY = """
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = current_schema()
  AND c.relname NOT IN ('alembic_version', 'spatial_ref_sys')
  AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
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


def enable_platform_management(table: str, visible_to_tenant: str) -> list[str]:
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY platform_read ON {table} FOR SELECT "
        f"USING ({PLATFORM_OPERATOR} OR {visible_to_tenant})",
        f"CREATE POLICY platform_write ON {table} FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
    ]


def disable_platform_management(table: str) -> list[str]:
    return [
        f"DROP POLICY platform_write ON {table}",
        f"DROP POLICY platform_read ON {table}",
        f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY",
    ]


def enable_auth_only(table: str) -> list[str]:
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY auth_only ON {table} USING ({AUTH_SERVICE}) WITH CHECK ({AUTH_SERVICE})",
    ]


def disable_auth_only(table: str) -> list[str]:
    return [
        f"DROP POLICY auth_only ON {table}",
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
