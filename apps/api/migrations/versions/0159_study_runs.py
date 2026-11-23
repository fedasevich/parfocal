from collections.abc import Sequence

from alembic import op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0159"
down_revision: str | None = "0158"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SESSIONS = "study_sessions"
PARTS = "study_trace_parts"

CREATE_SESSIONS = (
    "CREATE TABLE study_sessions ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " session_key character varying(80) NOT NULL,"
    " participant character varying(40) NOT NULL,"
    " round smallint NOT NULL,"
    " answers jsonb NOT NULL,"
    " dry_run boolean DEFAULT false NOT NULL,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " updated_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_study_sessions PRIMARY KEY (id),"
    " CONSTRAINT uq_study_sessions_tenant_id_session_key UNIQUE (tenant_id, session_key),"
    " CONSTRAINT fk_study_sessions_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id))"
)

CREATE_PARTS = (
    "CREATE TABLE study_trace_parts ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " session_key character varying(80) NOT NULL,"
    " seq bigint NOT NULL,"
    " body bytea NOT NULL,"
    " size integer NOT NULL,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_study_trace_parts PRIMARY KEY (id),"
    " CONSTRAINT uq_study_trace_parts_tenant_id_session_key_seq"
    " UNIQUE (tenant_id, session_key, seq),"
    " CONSTRAINT fk_study_trace_parts_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id))"
)


def upgrade() -> None:
    for statement in (
        CREATE_SESSIONS,
        f"CREATE INDEX ix_{SESSIONS}_tenant_id ON {SESSIONS} (tenant_id)",
        *enable_tenant_isolation(SESSIONS),
        CREATE_PARTS,
        f"CREATE INDEX ix_{PARTS}_tenant_id ON {PARTS} (tenant_id)",
        *enable_tenant_isolation(PARTS),
    ):
        op.execute(statement)


def downgrade() -> None:
    for table in (PARTS, SESSIONS):
        for statement in disable_tenant_isolation(table):
            op.execute(statement)
        op.execute(f"DROP TABLE {table}")
