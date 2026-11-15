from collections.abc import Sequence

from alembic import op

revision: str = "0116"
down_revision: str | None = "0115"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CURRENT_TENANT = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"

TABLES = ("painted_maps", "painted_map_versions")


def isolate(table: str) -> list[str]:
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = {CURRENT_TENANT}) WITH CHECK (tenant_id = {CURRENT_TENANT})",
    ]


UPGRADE = [
    "CREATE TABLE painted_maps ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " slide_id uuid NOT NULL,"
    " name character varying(80) NOT NULL,"
    " version integer DEFAULT 1 NOT NULL,"
    " cell integer NOT NULL,"
    " tile_cells integer NOT NULL,"
    " painted_cells integer NOT NULL,"
    " created_by_user_id uuid,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " updated_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_painted_maps PRIMARY KEY (id),"
    " CONSTRAINT uq_painted_maps_id_tenant_id UNIQUE (id, tenant_id),"
    " CONSTRAINT fk_painted_maps_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_painted_maps_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id)"
    " REFERENCES projects (id, tenant_id),"
    " CONSTRAINT fk_painted_maps_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id)"
    " REFERENCES slides (id, project_id),"
    " CONSTRAINT fk_painted_maps_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT ck_painted_maps_version CHECK (version > 0),"
    " CONSTRAINT ck_painted_maps_cell CHECK (cell > 0),"
    " CONSTRAINT ck_painted_maps_tile_cells CHECK (tile_cells > 0),"
    " CONSTRAINT ck_painted_maps_painted_cells CHECK (painted_cells >= 0))",
    "CREATE INDEX ix_painted_maps_tenant_id ON painted_maps (tenant_id)",
    "CREATE INDEX ix_painted_maps_slide_id ON painted_maps (slide_id)",
    "CREATE TRIGGER painted_maps_touch_updated_at BEFORE UPDATE ON painted_maps "
    "FOR EACH ROW EXECUTE FUNCTION parfocal_touch_updated_at()",
    "CREATE TABLE painted_map_versions ("
    " tenant_id uuid NOT NULL,"
    " painted_map_id uuid NOT NULL,"
    " version integer NOT NULL,"
    " content bytea NOT NULL,"
    " painted_cells integer NOT NULL,"
    " saved_by_user_id uuid,"
    " saved_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_painted_map_versions PRIMARY KEY (painted_map_id, version),"
    " CONSTRAINT fk_painted_map_versions_painted_map_id_tenant_id_painted_maps"
    " FOREIGN KEY (painted_map_id, tenant_id) REFERENCES painted_maps (id, tenant_id),"
    " CONSTRAINT fk_painted_map_versions_saved_by_user_id_users FOREIGN KEY (saved_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT ck_painted_map_versions_version CHECK (version > 0))",
    "CREATE INDEX ix_painted_map_versions_tenant_id ON painted_map_versions (tenant_id)",
    *isolate("painted_maps"),
    *isolate("painted_map_versions"),
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.execute(f"DROP TABLE {table}")
