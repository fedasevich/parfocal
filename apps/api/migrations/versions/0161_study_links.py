from collections.abc import Sequence

from alembic import op

from parfocal_common.schema_sql import disable_tenant_isolation, enable_tenant_isolation

revision: str = "0161"
down_revision: str | None = "0160"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LINKS = "study_links"
AUTH_SERVICE = "COALESCE(current_setting('app.auth', true), '') = 'on'"

CREATE_LINKS = (
    "CREATE TABLE study_links ("
    " id uuid DEFAULT gen_random_uuid() NOT NULL,"
    " tenant_id uuid NOT NULL,"
    " participant character varying(40) NOT NULL,"
    " token_hash bytea NOT NULL,"
    " created_by_user_id uuid,"
    " expires_at timestamp with time zone NOT NULL,"
    " redeemed_at timestamp with time zone,"
    " created_at timestamp with time zone DEFAULT now() NOT NULL,"
    " CONSTRAINT pk_study_links PRIMARY KEY (id),"
    " CONSTRAINT uq_study_links_token_hash UNIQUE (token_hash),"
    " CONSTRAINT fk_study_links_tenant_id_tenants FOREIGN KEY (tenant_id)"
    " REFERENCES tenants (id),"
    " CONSTRAINT fk_study_links_created_by_user_id_users FOREIGN KEY (created_by_user_id)"
    " REFERENCES users (id))"
)


def upgrade() -> None:
    for statement in (
        CREATE_LINKS,
        f"CREATE INDEX ix_{LINKS}_tenant_id ON {LINKS} (tenant_id)",
        *enable_tenant_isolation(LINKS),
        f"CREATE POLICY auth_read ON {LINKS} FOR SELECT USING ({AUTH_SERVICE})",
    ):
        op.execute(statement)


def downgrade() -> None:
    op.execute(f"DROP POLICY auth_read ON {LINKS}")
    for statement in disable_tenant_isolation(LINKS):
        op.execute(statement)
    op.execute(f"DROP TABLE {LINKS}")
