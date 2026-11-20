from collections.abc import Sequence

from alembic import op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0142"
down_revision: str | None = "0141"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "timing_events"

CREATE = (
    "CREATE TABLE timing_events ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " name character varying(30) NOT NULL,"
    " task_kind character varying(20),"
    " area character varying(20),"
    " duration_ms integer,"
    " estimated_ms integer,"
    " coverage_permille smallint,"
    " recorded_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_timing_events PRIMARY KEY (id),"
    " CONSTRAINT ck_timing_events_name CHECK (name IN ('task_finished', 'area_time_recorded',"
    " 'cell_review_timed', 'chrome_coverage_measured', 'reading_time_compared')),"
    " CONSTRAINT fk_timing_events_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id))"
)


def upgrade() -> None:
    for statement in (
        CREATE,
        "CREATE INDEX ix_timing_events_tenant_id ON timing_events (tenant_id)",
        "CREATE INDEX ix_timing_events_tenant_id_recorded_at"
        " ON timing_events (tenant_id, recorded_at)",
        *enable_tenant_isolation(TABLE),
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in disable_tenant_isolation(TABLE):
        op.execute(statement)
    op.execute(f"DROP TABLE {TABLE}")
