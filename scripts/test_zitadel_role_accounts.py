import shutil
import tempfile
import unittest
from pathlib import Path

try:
    import jwt  # noqa: F401

    import parfocal_api  # noqa: F401
except ImportError as missing:
    raise unittest.SkipTest("needs the uv workspace") from missing

from agent_session import REPOSITORY, ROLES, RefusedError
from zitadel_role_accounts import (
    SYMBOLS,
    RoleAccount,
    ensure,
    new_password,
    read_values,
    role_accounts,
    seed_role_emails,
)

from parfocal_api.showcase_roles import role_emails_of

MODEL = "agent-walk@example.test"
ORGANISATION = "org-1"


class FakeZitadel:
    def __init__(self, emails: set[str]) -> None:
        self.users = {MODEL, *emails}
        self.created: list[dict[str, object]] = []
        self.seen_file_mode: list[int] = []
        self.credentials: Path | None = None

    def __call__(self, method: str, path: str, body: dict[str, object]) -> dict[str, object]:
        if path == "/v2/users":
            [query] = body["queries"]  # type: ignore[index]
            email = query["emailQuery"]["emailAddress"]  # type: ignore[index]
            if email not in self.users:
                return {"result": []}
            return {"result": [{"username": email, "details": {"resourceOwner": ORGANISATION}}]}
        if path == "/v2/users/human":
            assert self.credentials is not None
            self.seen_file_mode.append(self.credentials.stat().st_mode & 0o777)
            password = body["password"]["password"]  # type: ignore[index]
            assert password in self.credentials.read_text()
            self.created.append(body)
            self.users.add(str(body["username"]))
            return {"userId": str(len(self.created))}
        raise AssertionError(f"unexpected {method} {path}")


class RoleAccountsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_path = Path(tempfile.mkdtemp())
        self.credentials = self.tmp_path / "role-accounts.env"
        self.accounts = role_accounts("example.test")
        counter = iter(range(100))
        self.passwords = lambda: f"generated-{next(counter)}"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_path, ignore_errors=True)

    def zitadel(self, emails: set[str] | None = None) -> FakeZitadel:
        fake = FakeZitadel(emails or set())
        fake.credentials = self.credentials
        return fake

    def test_missing_users_are_created_verified_after_their_password_is_saved(self) -> None:
        fake = self.zitadel()
        said = ensure(fake, self.credentials, self.accounts, MODEL, self.passwords)
        assert len(fake.created) == len(ROLES)
        assert all(mode == 0o600 for mode in fake.seen_file_mode)
        first = fake.created[0]
        assert first["organization"] == {"orgId": ORGANISATION}
        assert first["email"] == {"email": "role-researcher@example.test", "isVerified": True}
        assert first["password"]["changeRequired"] is False  # type: ignore[index]
        assert all("generated" not in line for line in said)
        values = read_values(self.credentials)
        assert values["PARFOCAL_ROLE_REVIEWER_A_EMAIL"] == "role-reviewer-a@example.test"
        assert values["PARFOCAL_ROLE_REVIEWER_A_PASSWORD"].startswith("generated-")

    def test_a_second_run_creates_nothing_and_keeps_every_password(self) -> None:
        fake = self.zitadel()
        ensure(fake, self.credentials, self.accounts, MODEL, self.passwords)
        before = self.credentials.read_text()
        again = self.zitadel(fake.users)
        said = ensure(again, self.credentials, self.accounts, MODEL, self.passwords)
        assert again.created == []
        assert self.credentials.read_text() == before
        assert all(line.endswith("exists, kept") for line in said)

    def test_an_existing_user_without_a_saved_password_is_left_alone(self) -> None:
        fake = self.zitadel({"role-viewer@example.test"})
        said = ensure(fake, self.credentials, self.accounts, MODEL, self.passwords)
        assert "role-viewer@example.test" not in [body["username"] for body in fake.created]
        assert any("role-viewer@example.test exists without a password" in line for line in said)
        assert "PARFOCAL_ROLE_VIEWER_PASSWORD" not in read_values(self.credentials)

    def test_no_model_account_and_files_in_the_repository_are_refused(self) -> None:
        fake = self.zitadel()
        fake.users.discard(MODEL)
        with self.assertRaisesRegex(RefusedError, "organisation is unknown"):
            ensure(fake, self.credentials, self.accounts, MODEL, self.passwords)
        with self.assertRaisesRegex(RefusedError, "inside the repository"):
            ensure(fake, REPOSITORY / "role-accounts.env", self.accounts, MODEL, self.passwords)
        assert fake.created == []

    def test_a_new_password_holds_every_character_class_the_policy_may_ask_for(self) -> None:
        password = new_password()
        assert len(password) >= 32
        assert any(character.isupper() for character in password)
        assert any(character.islower() for character in password)
        assert any(character.isdigit() for character in password)
        assert any(character in SYMBOLS for character in password)
        assert new_password() != password

    def test_the_seed_variable_names_two_reviewers_and_one_of_each_other_role(self) -> None:
        pairs = role_emails_of(seed_role_emails(role_accounts()))
        assert [pair.role for pair in pairs] == [
            "researcher",
            "reviewer",
            "reviewer",
            "adjudicator",
            "viewer",
            "annotator",
        ]
        assert RoleAccount("reviewer-b", "x@y").given_name == "Reviewer B"


if __name__ == "__main__":
    unittest.main()
