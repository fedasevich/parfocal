import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

from parfocal_common.db import CURRENT_TENANT
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REFUSE_UNLESS_PURGING = """
CREATE OR REPLACE FUNCTION parfocal_refuse_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('parfocal.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$
"""

REFUSE_ALWAYS = """
CREATE OR REPLACE FUNCTION parfocal_refuse_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$
"""

PURGE_FUNCTION = f"""
CREATE FUNCTION parfocal_retention_purge()
RETURNS TABLE(kind text, id uuid, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tenant uuid := {CURRENT_TENANT};
  policy record;
  cutoff timestamptz;
  through bigint;
  last_hash bytea;
  purged bigint;
BEGIN
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'retention needs a tenant scope' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO policy FROM retention_policies p WHERE p.tenant_id = tenant;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM legal_holds h
    WHERE h.tenant_id = tenant AND h.project_id IS NULL AND h.released_at IS NULL
  ) THEN
    RETURN QUERY SELECT 'held-workspace'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  CREATE TEMP TABLE held ON COMMIT DROP AS
    SELECT DISTINCT h.project_id FROM legal_holds h
    WHERE h.tenant_id = tenant AND h.project_id IS NOT NULL AND h.released_at IS NULL;
  IF policy.deleted_after_days IS NOT NULL THEN
    cutoff := now() - make_interval(days => policy.deleted_after_days);
    RETURN QUERY
      SELECT 'kept-held'::text, a.id, NULL::jsonb FROM annotations a
      WHERE a.tenant_id = tenant AND a.deleted_at < cutoff
        AND a.project_id IN (SELECT project_id FROM held)
      UNION ALL
      SELECT 'kept-held', r.id, NULL FROM result_sets r
      WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
        AND r.project_id IN (SELECT project_id FROM held)
      UNION ALL
      SELECT 'kept-held', s.id, NULL FROM slides s
      WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
        AND s.project_id IN (SELECT project_id FROM held);
    RETURN QUERY
      WITH doomed AS (
        SELECT a.id FROM annotations a
        WHERE a.tenant_id = tenant AND a.deleted_at < cutoff
          AND a.project_id NOT IN (SELECT project_id FROM held)
      ), versions AS (
        DELETE FROM annotation_versions v USING doomed d WHERE v.annotation_id = d.id
      ), gone AS (
        DELETE FROM annotations a USING doomed d WHERE a.id = d.id RETURNING a.id
      )
      SELECT 'annotation'::text, gone.id, NULL::jsonb FROM gone;
    RETURN QUERY
      SELECT 'kept-in-use'::text, r.id, NULL::jsonb FROM result_sets r
      WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
        AND r.project_id NOT IN (SELECT project_id FROM held)
        AND EXISTS (SELECT 1 FROM review_task_slides t WHERE t.result_set_id = r.id);
    RETURN QUERY
      WITH doomed AS (
        SELECT r.id FROM result_sets r
        WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
          AND r.project_id NOT IN (SELECT project_id FROM held)
          AND NOT EXISTS (SELECT 1 FROM review_task_slides t WHERE t.result_set_id = r.id)
      ), classes AS (
        DELETE FROM result_set_classes c USING doomed d WHERE c.result_set_id = d.id
      ), objects AS (
        DELETE FROM result_objects o USING doomed d WHERE o.result_set_id = d.id
      ), chunks AS (
        DELETE FROM result_chunks c USING doomed d WHERE c.result_set_id = d.id
      ), gone AS (
        DELETE FROM result_sets r USING doomed d WHERE r.id = d.id RETURNING r.id
      )
      SELECT 'result-set'::text, gone.id, NULL::jsonb FROM gone;
    RETURN QUERY
      SELECT 'kept-in-use'::text, s.id, NULL::jsonb FROM slides s
      WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
        AND s.project_id NOT IN (SELECT project_id FROM held)
        AND (
          EXISTS (SELECT 1 FROM review_task_slides t WHERE t.slide_id = s.id)
          OR EXISTS (SELECT 1 FROM result_sets r WHERE r.slide_id = s.id)
          OR EXISTS (SELECT 1 FROM annotations a WHERE a.slide_id = s.id)
        );
    RETURN QUERY
      WITH doomed AS (
        SELECT s.id FROM slides s
        WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
          AND s.project_id NOT IN (SELECT project_id FROM held)
          AND NOT EXISTS (SELECT 1 FROM review_task_slides t WHERE t.slide_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM result_sets r WHERE r.slide_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.slide_id = s.id)
      ), counters AS (
        DELETE FROM slide_counters c USING doomed d WHERE c.slide_id = d.id
      ), gone AS (
        DELETE FROM slides s USING doomed d WHERE s.id = d.id RETURNING s.id
      )
      SELECT 'slide'::text, gone.id, NULL::jsonb FROM gone;
  END IF;
  IF policy.audit_after_days IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || tenant::text, 0));
    SELECT e.seq, e.hash INTO through, last_hash FROM audit_events e
    WHERE e.tenant_id = tenant
      AND e.occurred_at < now() - make_interval(days => policy.audit_after_days)
    ORDER BY e.seq DESC LIMIT 1;
    IF FOUND THEN
      PERFORM set_config('parfocal.audit_purge', 'on', true);
      DELETE FROM audit_events e WHERE e.tenant_id = tenant AND e.seq <= through;
      GET DIAGNOSTICS purged = ROW_COUNT;
      PERFORM set_config('parfocal.audit_purge', 'off', true);
      RETURN QUERY SELECT 'audit'::text, NULL::uuid, jsonb_build_object(
        'through_seq', through, 'last_hash', encode(last_hash, 'hex'), 'count', purged
      );
    END IF;
  END IF;
END;
$$
"""


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    op.create_table(
        "retention_policies",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("deleted_after_days", sa.Integer, nullable=True),
        sa.Column("audit_after_days", sa.Integer, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("deleted_after_days >= 1", name="deleted_after_days"),
        sa.CheckConstraint("audit_after_days >= 365", name="audit_after_days"),
    )
    op.create_table(
        "legal_holds",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column(
            "placed_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "released_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    )
    for statement in [
        *enable_tenant_isolation("retention_policies"),
        *track_updated_at("retention_policies"),
        *enable_tenant_isolation("legal_holds"),
        *track_updated_at("legal_holds"),
        f"REVOKE DELETE, TRUNCATE ON legal_holds FROM {app_role()}",
        REFUSE_UNLESS_PURGING,
        PURGE_FUNCTION,
        "REVOKE ALL ON FUNCTION parfocal_retention_purge() FROM PUBLIC",
        f"GRANT EXECUTE ON FUNCTION parfocal_retention_purge() TO {app_role()}",
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP FUNCTION parfocal_retention_purge()")
    op.execute(REFUSE_ALWAYS)
    op.execute(untrack_updated_at("legal_holds")[0])
    op.execute(untrack_updated_at("retention_policies")[0])
    op.drop_table("legal_holds")
    op.drop_table("retention_policies")
