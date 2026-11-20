from collections.abc import Sequence

from alembic import context, op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0145"
down_revision: str | None = "0144"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "dataset_versions"

CREATE = (
    "CREATE TABLE dataset_versions ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " task_id uuid NOT NULL,"
    " number integer NOT NULL,"
    " note character varying(500) DEFAULT '' NOT NULL,"
    " filters jsonb NOT NULL,"
    " counts jsonb NOT NULL,"
    " object_key character varying(200) NOT NULL,"
    " sha256 character varying(64) NOT NULL,"
    " bytes bigint NOT NULL,"
    " created_by_user_id uuid,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_dataset_versions PRIMARY KEY (id),"
    " CONSTRAINT uq_dataset_versions_task_id_number UNIQUE (task_id, number),"
    " CONSTRAINT fk_dataset_versions_task_id_project_id_tenant_id_review_tasks"
    " FOREIGN KEY (task_id, project_id, tenant_id)"
    " REFERENCES review_tasks (id, project_id, tenant_id),"
    " CONSTRAINT fk_dataset_versions_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT ck_dataset_versions_number CHECK (number > 0),"
    " CONSTRAINT ck_dataset_versions_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),"
    " CONSTRAINT ck_dataset_versions_bytes CHECK (bytes > 0),"
    " CONSTRAINT fk_dataset_versions_tenant_id_tenants FOREIGN KEY (tenant_id)"
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
    op.execute(f"DROP TABLE {TABLE}")
