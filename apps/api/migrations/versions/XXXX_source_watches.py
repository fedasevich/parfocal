from collections.abc import Sequence

from alembic import op

from parfocal_common.schema_sql import (
    disable_tenant_isolation,
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0134"
down_revision: str | None = "0133"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WATCHES = "source_watches"
FILES = "watched_files"

CREATE_WATCHES = (
    "CREATE TABLE source_watches ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " source_id uuid NOT NULL,"
    " created_by_user_id uuid,"
    " scanned_at timestamp with time zone,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " updated_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_source_watches PRIMARY KEY (id),"
    " CONSTRAINT uq_source_watches_project_id UNIQUE (project_id),"
    " CONSTRAINT uq_source_watches_id_tenant_id UNIQUE (id, tenant_id),"
    " CONSTRAINT fk_source_watches_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_source_watches_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT fk_source_watches_project_id_tenant_id_projects"
    " FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,"
    " CONSTRAINT fk_source_watches_source_id_tenant_id_import_sources"
    " FOREIGN KEY (source_id, tenant_id) REFERENCES import_sources (id, tenant_id)"
    " ON DELETE CASCADE)"
)

CREATE_FILES = (
    "CREATE TABLE watched_files ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " watch_id uuid NOT NULL,"
    " name character varying(1024) NOT NULL,"
    " upload_id uuid,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_watched_files PRIMARY KEY (id),"
    " CONSTRAINT uq_watched_files_watch_id_name UNIQUE (watch_id, name),"
    " CONSTRAINT fk_watched_files_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_watched_files_watch_id_tenant_id_source_watches"
    " FOREIGN KEY (watch_id, tenant_id) REFERENCES source_watches (id, tenant_id)"
    " ON DELETE CASCADE)"
)


def upgrade() -> None:
    for statement in (
        CREATE_WATCHES,
        "CREATE INDEX ix_source_watches_tenant_id ON source_watches (tenant_id)",
        "CREATE INDEX ix_source_watches_source_id ON source_watches (source_id)",
        *enable_tenant_isolation(WATCHES),
        *track_updated_at(WATCHES),
        CREATE_FILES,
        "CREATE INDEX ix_watched_files_tenant_id ON watched_files (tenant_id)",
        *enable_tenant_isolation(FILES),
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in disable_tenant_isolation(FILES):
        op.execute(statement)
    op.execute(f"DROP TABLE {FILES}")
    for statement in untrack_updated_at(WATCHES):
        op.execute(statement)
    for statement in disable_tenant_isolation(WATCHES):
        op.execute(statement)
    op.execute(f"DROP TABLE {WATCHES}")
