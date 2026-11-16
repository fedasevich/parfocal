from collections.abc import Sequence

from alembic import op

revision: str = "0119"
down_revision: str | None = "0118"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PURGE_WITH_PAINTED_MAPS = r"""
CREATE OR REPLACE FUNCTION public.parfocal_retention_purge()
    RETURNS TABLE(kind text, id uuid, detail jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
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
      ), map_versions AS (
        DELETE FROM painted_map_versions v USING painted_maps m, doomed d
        WHERE v.painted_map_id = m.id AND m.slide_id = d.id
      ), maps AS (
        DELETE FROM painted_maps m USING doomed d WHERE m.slide_id = d.id
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
$$;
"""

PURGE_WITHOUT_PAINTED_MAPS = r"""
CREATE OR REPLACE FUNCTION public.parfocal_retention_purge()
    RETURNS TABLE(kind text, id uuid, detail jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
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
$$;
"""


def upgrade() -> None:
    op.execute(PURGE_WITH_PAINTED_MAPS)


def downgrade() -> None:
    op.execute(PURGE_WITHOUT_PAINTED_MAPS)
