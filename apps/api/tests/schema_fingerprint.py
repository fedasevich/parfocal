import hashlib
import json

from db_support import query

NOT_FROM_AN_EXTENSION = (
    "NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = {oid} AND d.deptype = 'e')"
)
IN_PUBLIC = "{namespace} = 'public'::regnamespace"

SECTIONS = {
    "extensions": "SELECT extname, '' FROM pg_extension WHERE extname <> 'plpgsql'",
    "relations": (
        "SELECT c.relname, concat_ws(' ', c.relkind, c.relrowsecurity, c.relforcerowsecurity, "
        "c.relacl::text) FROM pg_class c WHERE "
        + IN_PUBLIC.format(namespace="c.relnamespace")
        + " AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND "
        + NOT_FROM_AN_EXTENSION.format(oid="c.oid")
    ),
    "columns": (
        "SELECT c.relname, string_agg(concat_ws(' ', a.attname, format_type(a.atttypid, "
        "a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated, a.attcollation, "
        "pg_get_expr(d.adbin, d.adrelid), a.attacl::text), ', ' ORDER BY a.attnum) "
        "FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 "
        "AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum "
        "WHERE "
        + IN_PUBLIC.format(namespace="c.relnamespace")
        + " AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND "
        + NOT_FROM_AN_EXTENSION.format(oid="c.oid")
        + " GROUP BY c.relname"
    ),
    "constraints": (
        "SELECT conrelid::regclass::text || '.' || conname, "
        "concat_ws(' ', pg_get_constraintdef(oid), condeferrable, condeferred) FROM pg_constraint "
        "WHERE " + IN_PUBLIC.format(namespace="connamespace") + " AND conrelid <> 0"
    ),
    "indexes": "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    "triggers": (
        "SELECT tgrelid::regclass::text || '.' || tgname, "
        "concat_ws(' ', pg_get_triggerdef(oid), tgenabled) FROM pg_trigger WHERE NOT tgisinternal"
    ),
    "functions": (
        "SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', "
        "concat_ws(' ', pg_get_functiondef(p.oid), p.proacl::text) FROM pg_proc p WHERE "
        + IN_PUBLIC.format(namespace="p.pronamespace")
        + " AND "
        + NOT_FROM_AN_EXTENSION.format(oid="p.oid")
    ),
    "types": (
        "SELECT t.typname, concat_ws(' ', t.typtype, format_type(t.typbasetype, t.typtypmod), "
        "(SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e "
        "WHERE e.enumtypid = t.oid)) FROM pg_type t WHERE "
        + IN_PUBLIC.format(namespace="t.typnamespace")
        + " AND t.typtype IN ('e', 'd') AND "
        + NOT_FROM_AN_EXTENSION.format(oid="t.oid")
    ),
    "policies": (
        "SELECT tablename || '.' || policyname, concat_ws(' ', permissive, roles::text, cmd, "
        "qual, with_check) FROM pg_policies WHERE schemaname = 'public'"
    ),
    "default_privileges": (
        "SELECT defaclobjtype::text, defaclacl::text FROM pg_default_acl "
        "WHERE defaclnamespace = 'public'::regnamespace"
    ),
    "schema_privileges": "SELECT nspname, nspacl::text FROM pg_namespace WHERE nspname = 'public'",
}

TABLES = (
    "SELECT c.relname FROM pg_class c WHERE "
    + IN_PUBLIC.format(namespace="c.relnamespace")
    + " AND c.relkind IN ('r', 'p') AND c.relname <> 'alembic_version' AND "
    + NOT_FROM_AN_EXTENSION.format(oid="c.oid")
)
ROW_WITHOUT_MINTED_VALUES = "(to_jsonb(r) - 'id' - 'created_at' - 'updated_at')::text"
ROWS = (
    f"SELECT '{{table}}', coalesce(string_agg({ROW_WITHOUT_MINTED_VALUES}, ',' "
    f"ORDER BY {ROW_WITHOUT_MINTED_VALUES}), '') FROM public.{{table}} r"
)


def digest(value: object) -> int:
    return int.from_bytes(hashlib.sha256(json.dumps(value).encode()).digest()[:7])


def section(url: str, statement: str) -> dict[str, int]:
    return {str(name): digest(str(detail)) for name, detail in query(url, statement)}


def schema_of(url: str) -> dict[str, dict[str, int]]:
    found = {name: section(url, statement) for name, statement in SECTIONS.items()}
    tables = sorted(str(row[0]) for row in query(url, TABLES))
    found["rows"] = section(url, " UNION ALL ".join(ROWS.format(table=name) for name in tables))
    return found
