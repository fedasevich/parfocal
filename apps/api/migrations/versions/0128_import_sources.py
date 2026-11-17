from collections.abc import Sequence

from alembic import op

from parfocal_common.schema_sql import (
    disable_tenant_isolation,
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0128"
down_revision: str | None = "0127"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "import_sources"

CREATE = (
    "CREATE TABLE import_sources ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " name character varying(80) NOT NULL,"
    " kind character varying(10) NOT NULL,"
    " address character varying(2048) NOT NULL,"
    " region character varying(40),"
    " header_name character varying(80),"
    " credential_ciphertext bytea,"
    " created_by_user_id uuid,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " updated_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_import_sources PRIMARY KEY (id),"
    " CONSTRAINT uq_import_sources_tenant_id_name UNIQUE (tenant_id, name),"
    " CONSTRAINT uq_import_sources_id_tenant_id UNIQUE (id, tenant_id),"
    " CONSTRAINT fk_import_sources_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_import_sources_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT ck_import_sources_kind CHECK (kind IN ('https', 'storage')))"
)


def upgrade() -> None:
    for statement in (
        CREATE,
        "CREATE INDEX ix_import_sources_tenant_id ON import_sources (tenant_id)",
        *enable_tenant_isolation(TABLE),
        *track_updated_at(TABLE),
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in untrack_updated_at(TABLE) + disable_tenant_isolation(TABLE):
        op.execute(statement)
    op.execute(f"DROP TABLE {TABLE}")
