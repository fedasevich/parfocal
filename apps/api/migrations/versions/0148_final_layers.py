from collections.abc import Sequence

from alembic import context, op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0148"
down_revision: str | None = "0147"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "final_layers"

CREATE = (
    "CREATE TABLE final_layers ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " task_id uuid NOT NULL,"
    " slide_id uuid NOT NULL,"
    " build integer NOT NULL,"
    " task_version integer NOT NULL,"
    " objects jsonb NOT NULL,"
    " counts jsonb NOT NULL,"
    " built_by_user_id uuid,"
    " built_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_final_layers PRIMARY KEY (id),"
    " CONSTRAINT uq_final_layers_task_id_slide_id_build UNIQUE (task_id, slide_id, build),"
    " CONSTRAINT fk_final_layers_task_id_project_id_tenant_id_review_tasks"
    " FOREIGN KEY (task_id, project_id, tenant_id)"
    " REFERENCES review_tasks (id, project_id, tenant_id),"
    " CONSTRAINT fk_final_layers_task_id_slide_id_tenant_id"
    " FOREIGN KEY (task_id, slide_id, tenant_id)"
    " REFERENCES review_task_slides (task_id, slide_id, tenant_id),"
    " CONSTRAINT fk_final_layers_built_by_user_id_users FOREIGN KEY (built_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT ck_final_layers_build CHECK (build > 0),"
    " CONSTRAINT ck_final_layers_task_version CHECK (task_version > 0),"
    " CONSTRAINT fk_final_layers_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id))"
)


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    for statement in (
        CREATE,
        f"CREATE INDEX ix_{TABLE}_tenant_id ON {TABLE} (tenant_id)",
        *enable_tenant_isolation(TABLE),
        f"REVOKE ALL ON {TABLE} FROM {app_role()}",
        f"GRANT SELECT, INSERT ON {TABLE} TO {app_role()}",
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in disable_tenant_isolation(TABLE):
        op.execute(statement)
    op.drop_table(TABLE)
