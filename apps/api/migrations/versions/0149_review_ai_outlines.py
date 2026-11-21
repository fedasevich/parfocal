from collections.abc import Sequence

from alembic import context, op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0149"
down_revision: str | None = "0148"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "review_ai_outlines"

CREATE = (
    "CREATE TABLE review_ai_outlines ("
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " task_id uuid NOT NULL,"
    " slide_id uuid NOT NULL,"
    " kind character varying(10) NOT NULL,"
    " number integer NOT NULL,"
    " outline geometry NOT NULL,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_review_ai_outlines PRIMARY KEY (task_id, slide_id, kind, number),"
    " CONSTRAINT fk_review_ai_outlines_task_id_slide_id_tenant_id"
    " FOREIGN KEY (task_id, slide_id, tenant_id)"
    " REFERENCES review_task_slides (task_id, slide_id, tenant_id),"
    " CONSTRAINT fk_review_ai_outlines_project_id_tenant_id_projects"
    " FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id),"
    " CONSTRAINT ck_review_ai_outlines_kind CHECK (kind IN ('region', 'cell')),"
    " CONSTRAINT ck_review_ai_outlines_number CHECK (number > 0),"
    " CONSTRAINT ck_review_ai_outlines_outline_valid CHECK (ST_IsValid(outline)))"
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
