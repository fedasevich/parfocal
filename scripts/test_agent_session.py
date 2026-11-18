import contextlib
import io
import json
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar

from agent_session import (
    ENVIRONMENTS,
    REPOSITORY,
    SESSION_COOKIE,
    RefusedError,
    main,
    mint,
)
from guard_destructive import refuse_command

EMAIL = "agent-walk@example.test"
PHRASE = "-".join(("fake", "phrase", "for", "tests"))
WRONG = "-".join(("other", "phrase"))
COOKIE = "session-value-abc"


class FakeApp(BaseHTTPRequestHandler):
    workspaces: ClassVar[list[str]] = ["cvut-biomedical", "cvut-ml"]
    signed_out: ClassVar[list[str]] = []

    def log_message(self, *args: object) -> None:
        return None

    def answer(self, status: int, body: object, cookie: str | None = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if cookie is not None:
            self.send_header(
                "Set-Cookie",
                f"{SESSION_COOKIE}={cookie}; Max-Age=3600; Path=/; Secure; HttpOnly; "
                "SameSite=strict",
            )
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def signed_in(self) -> bool:
        return self.headers.get("Cookie") == f"{SESSION_COOKIE}={COOKIE}"

    def do_POST(self) -> None:
        sent = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path != "/api/auth/sign-in":
            self.answer(404, {"title": "Not found"})
        elif sent == {"email": EMAIL, "password": PHRASE, "return_to": "/"}:
            self.answer(200, {"return_to": "/"}, COOKIE)
        else:
            self.answer(401, {"title": "Wrong email or password"})

    def do_GET(self) -> None:
        if not self.signed_in():
            self.answer(401, {"title": "Sign in"})
        elif self.path == "/api/me":
            self.answer(200, {"workspaces": [{"slug": slug} for slug in self.workspaces]})
        elif self.path == "/api/auth/logout":
            FakeApp.signed_out.append(self.path)
            self.answer(200, {})
        else:
            self.answer(404, {"title": "Not found"})


def environments(tmp_path: Path, environment: str = "development") -> Path:
    path = tmp_path / "environments.json"
    path.write_text(
        json.dumps(
            {
                "apps": {
                    "127.0.0.1": {"environment": environment},
                    "app.example.test": {"environment": "development"},
                    "real.example.test": {"environment": "production"},
                },
                "test_accounts": [EMAIL],
                "seeded_workspaces": ["cvut-biomedical", "cvut-imaging", "cvut-ml"],
            }
        )
    )
    return path


def credentials(tmp_path: Path, email: str = EMAIL, mode: int = 0o600) -> Path:
    path = tmp_path / "agent-account.env"
    path.write_text(f"PARFOCAL_AGENT_EMAIL={email}\nPARFOCAL_AGENT_PASSWORD={PHRASE}\n")
    path.chmod(mode)
    return path


class AgentSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeApp.workspaces = ["cvut-biomedical", "cvut-ml"]
        FakeApp.signed_out = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeApp)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.app = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.tmp_path = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.tmp_path, ignore_errors=True)

    def test_a_seeded_account_gets_a_private_playwright_storage_state(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        out = tmp_path / "state" / "agent-session.json"
        said = mint(app, credentials(tmp_path), out, environments(tmp_path))
        assert PHRASE not in said
        assert COOKIE not in said
        assert "cvut-biomedical, cvut-ml" in said
        assert out.stat().st_mode & 0o777 == 0o600
        state = json.loads(out.read_text())
        [cookie] = state["cookies"]
        assert (cookie["name"], cookie["value"], cookie["domain"]) == (
            SESSION_COOKIE,
            COOKIE,
            "127.0.0.1",
        )
        assert (cookie["httpOnly"], cookie["secure"], cookie["sameSite"]) == (True, True, "Strict")
        assert cookie["expires"] > 0
        assert state["origins"] == []

    def test_an_account_in_a_workspace_that_is_not_seeded_is_signed_out_and_refused(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        FakeApp.workspaces = ["cvut-ml", "real-hospital"]
        out = tmp_path / "agent-session.json"
        with self.assertRaisesRegex(RefusedError, "real-hospital"):
            mint(app, credentials(tmp_path), out, environments(tmp_path))
        assert FakeApp.signed_out == ["/api/auth/logout"]
        assert not out.exists()

    def test_an_account_with_no_workspace_is_refused(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        FakeApp.workspaces = []
        with self.assertRaisesRegex(RefusedError, "no workspace"):
            mint(app, credentials(tmp_path), tmp_path / "out.json", environments(tmp_path))

    def test_a_deployment_declared_production_is_refused_before_any_call(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(RefusedError, "not declared a development environment"):
            mint(
                app,
                credentials(tmp_path),
                tmp_path / "o.json",
                environments(tmp_path, "production"),
            )
        with self.assertRaisesRegex(RefusedError, "not declared"):
            mint(
                "https://real.example.test",
                credentials(tmp_path),
                tmp_path / "o.json",
                environments(tmp_path),
            )
        with self.assertRaisesRegex(RefusedError, "not declared"):
            mint(
                "https://unknown.example.test",
                credentials(tmp_path),
                tmp_path / "o.json",
                environments(tmp_path),
            )

    def test_a_development_host_away_from_this_machine_needs_https(self) -> None:
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(RefusedError, "https"):
            mint(
                "http://app.example.test",
                credentials(tmp_path),
                tmp_path / "o.json",
                environments(tmp_path),
            )

    def test_an_account_that_is_not_a_seeded_test_account_is_refused(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(RefusedError, "not a seeded test account"):
            mint(
                app,
                credentials(tmp_path, "someone@hospital.test"),
                tmp_path / "o.json",
                environments(tmp_path),
            )

    def test_a_credential_file_others_can_read_is_refused(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(RefusedError, "chmod 600"):
            mint(
                app, credentials(tmp_path, mode=0o644), tmp_path / "o.json", environments(tmp_path)
            )
        with self.assertRaisesRegex(RefusedError, "does not exist"):
            mint(app, tmp_path / "missing.env", tmp_path / "o.json", environments(tmp_path))

    def test_files_inside_the_repository_are_refused(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        inside = REPOSITORY / "agent-session.json"
        with self.assertRaisesRegex(RefusedError, "inside the repository"):
            mint(app, credentials(tmp_path), inside, environments(tmp_path))
        assert not inside.exists()

    def test_a_wrong_password_reports_the_title_and_not_the_password(self) -> None:
        app = self.app
        tmp_path = self.tmp_path
        path = credentials(tmp_path)
        path.write_text(f"PARFOCAL_AGENT_EMAIL={EMAIL}\nPARFOCAL_AGENT_PASSWORD={WRONG}\n")
        err = io.StringIO()
        printed_out = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(printed_out):
            code = main(
                [
                    *("--url", app, "--credentials", str(path), "--out", str(tmp_path / "o.json")),
                    *("--environments", str(environments(tmp_path))),
                ]
            )
        assert code == 2
        assert "401 Wrong email or password" in err.getvalue()
        assert WRONG not in err.getvalue() + printed_out.getvalue()

    def test_the_committed_environments_declare_the_deployed_app_development(self) -> None:
        declared = json.loads(ENVIRONMENTS.read_text())
        assert declared["apps"]["app.parfocal.eu"]["environment"] == "development"
        assert all(email.endswith("@parfocal.eu") for email in declared["test_accounts"])

    def test_the_destructive_guard_lets_the_script_run(self) -> None:
        assert refuse_command("python3 scripts/agent_session.py") is None
        assert (
            refuse_command("python3 scripts/agent_session.py --url https://app.parfocal.eu") is None
        )


if __name__ == "__main__":
    unittest.main()
