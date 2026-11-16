from collections.abc import Sequence

from alembic import op

revision: str = "0126"
down_revision: str | None = "0125"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SHARED_QUEUE_MINUTES = r"""
CREATE FUNCTION public.parfocal_shared_queue_minutes(minutes jsonb)
    RETURNS double precision
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  total double precision;
BEGIN
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'the shared queue needs a tenant scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(sum(GREATEST(0.0,
      (minutes ->> r.detector)::double precision
      - CASE WHEN j.status = 'running' THEN COALESCE(
          EXTRACT(EPOCH FROM now() - (
            SELECT min(s.started_at) FROM job_steps s WHERE s.job_id = j.id
          )) / 60.0, 0.0)
        ELSE 0.0 END
    )), 0.0)
    INTO total
    FROM model_runs r
    JOIN jobs j ON j.id = r.job_id
    WHERE j.status IN ('queued', 'running')
      AND r.tenant_id <> tenant
      AND minutes ? r.detector;
  RETURN total;
END;
$$;
"""


def upgrade() -> None:
    op.execute(SHARED_QUEUE_MINUTES)


def downgrade() -> None:
    op.execute("DROP FUNCTION public.parfocal_shared_queue_minutes(jsonb)")
