import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

from parfocal_common.db import AUTH_SERVICE, PLATFORM_OPERATOR
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTOR_KIND_CHECK = "actor_kind IN ('user', 'member', 'operator', 'system')"

AUDIT_FIELD_FUNCTION = """
CREATE FUNCTION parfocal_audit_field(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(length(value)::text || ':' || value, '-')
$$
"""

CHAIN_FUNCTION = """
CREATE FUNCTION parfocal_chain_audit_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('audit:' || coalesce(NEW.tenant_id::text, 'platform'), 0)
  );
  IF NEW.tenant_id IS NULL THEN
    SELECT seq, hash INTO last_seq, last_hash FROM audit_events
    WHERE tenant_id IS NULL ORDER BY seq DESC LIMIT 1;
  ELSE
    SELECT seq, hash INTO last_seq, last_hash FROM audit_events
    WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  END IF;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := coalesce(last_hash, decode(repeat('00', 32), 'hex'));
  NEW.occurred_at := clock_timestamp();
  NEW.hash := sha256(NEW.prev_hash || convert_to(concat(
    parfocal_audit_field(NEW.id::text),
    parfocal_audit_field(NEW.tenant_id::text),
    parfocal_audit_field(NEW.seq::text),
    parfocal_audit_field(
      to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ),
    parfocal_audit_field(NEW.actor_kind),
    parfocal_audit_field(NEW.actor_id::text),
    parfocal_audit_field(NEW.action),
    parfocal_audit_field(NEW.target_type),
    parfocal_audit_field(NEW.target_id::text),
    parfocal_audit_field(NEW.details)
  ), 'UTF8'));
  RETURN NEW;
END;
$$
"""

REFUSE_FUNCTION = """
CREATE FUNCTION parfocal_refuse_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$
"""


KNOWN_PERSON = f"{PLATFORM_OPERATOR} OR {AUTH_SERVICE} OR subject IN (SELECT subject FROM users)"


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    op.create_table(
        "audit_people",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("subject", sa.String(200), nullable=False, unique=True),
    )
    op.create_table(
        "audit_events",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("seq", sa.BigInteger, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_kind", sa.String(20), nullable=False),
        sa.Column("actor_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("action", sa.String(60), nullable=False),
        sa.Column("target_type", sa.String(40), nullable=False),
        sa.Column("target_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("details", sa.Text, nullable=False, server_default="{}"),
        sa.Column("prev_hash", sa.LargeBinary, nullable=False),
        sa.Column("hash", sa.LargeBinary, nullable=False),
        sa.UniqueConstraint("tenant_id", "seq", postgresql_nulls_not_distinct=True),
        sa.CheckConstraint(ACTOR_KIND_CHECK, name="actor_kind"),
    )
    op.create_index(
        "ix_audit_events_tenant_id_target_type_target_id",
        "audit_events",
        ["tenant_id", "target_type", "target_id"],
    )
    for statement in [
        AUDIT_FIELD_FUNCTION,
        CHAIN_FUNCTION,
        REFUSE_FUNCTION,
        "CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_chain_audit_event()",
        "CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_refuse_audit_change()",
        "CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events "
        "FOR EACH STATEMENT EXECUTE FUNCTION parfocal_refuse_audit_change()",
        f"REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM {app_role()}",
        *enable_tenant_isolation("audit_events"),
        f"CREATE POLICY platform_audit ON audit_events FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
        f"CREATE POLICY auth_audit ON audit_events FOR ALL "
        f"USING (tenant_id IS NULL AND {AUTH_SERVICE}) "
        f"WITH CHECK (tenant_id IS NULL AND {AUTH_SERVICE})",
        "ALTER TABLE audit_people ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE audit_people FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY known_people ON audit_people FOR SELECT USING ({KNOWN_PERSON})",
        f"CREATE POLICY new_people ON audit_people FOR INSERT WITH CHECK ({KNOWN_PERSON})",
        f"CREATE POLICY platform_forgets ON audit_people FOR DELETE USING ({PLATFORM_OPERATOR})",
        f"REVOKE UPDATE, TRUNCATE ON audit_people FROM {app_role()}",
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("audit_people")
    for function in (
        "parfocal_refuse_audit_change()",
        "parfocal_chain_audit_event()",
        "parfocal_audit_field(text)",
    ):
        op.execute(f"DROP FUNCTION {function}")
