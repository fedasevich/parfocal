from collections.abc import Sequence

from alembic import op

from parfocal_common.db import AUTH_SERVICE
from parfocal_common.schema_sql import (
    disable_tenant_isolation,
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0129"
down_revision: str | None = "0128"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

HOOKS = "project_webhooks"
CALLS = "webhook_calls"

CREATE_HOOKS = (
    "CREATE TABLE project_webhooks ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " project_id uuid NOT NULL,"
    " hook_key character varying(32) NOT NULL,"
    " secret_ciphertext bytea NOT NULL,"
    " old_secret_ciphertext bytea,"
    " rotated_at timestamp with time zone,"
    " created_by_user_id uuid,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " updated_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_project_webhooks PRIMARY KEY (id),"
    " CONSTRAINT uq_project_webhooks_project_id UNIQUE (project_id),"
    " CONSTRAINT uq_project_webhooks_hook_key UNIQUE (hook_key),"
    " CONSTRAINT uq_project_webhooks_id_tenant_id UNIQUE (id, tenant_id),"
    " CONSTRAINT fk_project_webhooks_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_project_webhooks_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id),"
    " CONSTRAINT fk_project_webhooks_project_id_tenant_id_projects"
    " FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE)"
)

CREATE_CALLS = (
    "CREATE TABLE webhook_calls ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " webhook_id uuid NOT NULL,"
    " idempotency_key character varying(200),"
    " answer jsonb NOT NULL,"
    " slide_upload_id uuid,"
    " task_id uuid,"
    " task_attached_at timestamp with time zone,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_webhook_calls PRIMARY KEY (id),"
    " CONSTRAINT uq_webhook_calls_webhook_id_idempotency_key UNIQUE (webhook_id, idempotency_key),"
    " CONSTRAINT fk_webhook_calls_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_webhook_calls_webhook_id_tenant_id_project_webhooks"
    " FOREIGN KEY (webhook_id, tenant_id) REFERENCES project_webhooks (id, tenant_id)"
    " ON DELETE CASCADE)"
)


def upgrade() -> None:
    for statement in (
        CREATE_HOOKS,
        "CREATE INDEX ix_project_webhooks_tenant_id ON project_webhooks (tenant_id)",
        *enable_tenant_isolation(HOOKS),
        f"CREATE POLICY auth_read ON {HOOKS} FOR SELECT USING ({AUTH_SERVICE})",
        *track_updated_at(HOOKS),
        CREATE_CALLS,
        "CREATE INDEX ix_webhook_calls_tenant_id ON webhook_calls (tenant_id)",
        "CREATE INDEX ix_webhook_calls_webhook_id ON webhook_calls (webhook_id)",
        "CREATE INDEX ix_webhook_calls_slide_upload_id ON webhook_calls (slide_upload_id)",
        *enable_tenant_isolation(CALLS),
    ):
        op.execute(statement)


def downgrade() -> None:
    op.execute(f"DROP TABLE {CALLS}")
    for statement in untrack_updated_at(HOOKS):
        op.execute(statement)
    op.execute(f"DROP POLICY auth_read ON {HOOKS}")
    for statement in disable_tenant_isolation(HOOKS):
        op.execute(statement)
    op.execute(f"DROP TABLE {HOOKS}")
