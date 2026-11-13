from collections.abc import Sequence

from alembic import context, op

from parfocal_common.db import AUTH_SERVICE, CURRENT_USER, PLATFORM_OPERATOR

revision: str = "0112"
down_revision: str | None = "0111"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SERVICE = f"{PLATFORM_OPERATOR} OR {AUTH_SERVICE}"
SELF = f"id = {CURRENT_USER}"

KEEP_TOKEN_REVOKED = """
CREATE FUNCTION parfocal_keep_token_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'a revoked API token stays revoked'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$
"""

GUARD_USER_IDENTITY = f"""
CREATE FUNCTION parfocal_guard_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.email IS DISTINCT FROM OLD.email OR NEW.subject IS DISTINCT FROM OLD.subject)
        AND row_security_active(TG_RELID)
        AND NOT ({SERVICE})
    THEN
        RAISE EXCEPTION 'email and subject change only under the auth or platform scope'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$
"""


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    role = app_role()
    for statement in [
        f"REVOKE UPDATE ON api_tokens FROM {role}",
        f"GRANT UPDATE (last_used_at, revoked_at) ON api_tokens TO {role}",
        KEEP_TOKEN_REVOKED,
        "CREATE TRIGGER api_tokens_keep_revoked BEFORE UPDATE ON api_tokens "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_keep_token_revoked()",
        GUARD_USER_IDENTITY,
        "CREATE TRIGGER users_guard_identity BEFORE UPDATE ON users "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_guard_user_identity()",
        "DROP POLICY users_write ON users",
        f"CREATE POLICY users_write ON users FOR ALL USING ({SERVICE}) WITH CHECK ({SERVICE})",
        f"CREATE POLICY users_self ON users FOR UPDATE USING ({SELF}) WITH CHECK ({SELF})",
    ]:
        op.execute(statement)


def downgrade() -> None:
    role = app_role()
    for statement in [
        "DROP POLICY users_self ON users",
        "DROP POLICY users_write ON users",
        f"CREATE POLICY users_write ON users FOR ALL USING ({SERVICE} OR {SELF}) "
        f"WITH CHECK ({SERVICE} OR {SELF})",
        "DROP TRIGGER users_guard_identity ON users",
        "DROP FUNCTION parfocal_guard_user_identity()",
        "DROP TRIGGER api_tokens_keep_revoked ON api_tokens",
        "DROP FUNCTION parfocal_keep_token_revoked()",
        f"REVOKE UPDATE (last_used_at, revoked_at) ON api_tokens FROM {role}",
        f"GRANT UPDATE ON api_tokens TO {role}",
    ]:
        op.execute(statement)
