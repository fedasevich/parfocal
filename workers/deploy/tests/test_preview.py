import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from smoke_site import secured_page_headers

from parfocal_deploy import neon, preview
from parfocal_deploy.modal_app import CONFIG_SECRET, KEYS_SECRET, LOGIN_SECRET
from parfocal_deploy.preview import (
    BadNumberError,
    PreviewLimitError,
    RefusedError,
    create,
    guard_key,
    guard_modal_environment,
    guard_neon_branch,
    guard_prefix,
    guard_worker,
    names,
    sweep,
    teardown,
)
from parfocal_deploy.smoke import ISOLATION_HEADERS
from parfocal_deploy.tools import REPOSITORY, MissingSettingsError, Tools

NOW = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)
LOCAL = {
    "NEON_API_KEY": "neon-key",
    "NEON_PROJECT_ID": "preview-project",
    "CLOUDFLARE_ACCOUNT_ID": "account-1",
    "CLOUDFLARE_API_TOKEN": "cloudflare-token",
    "MODAL_TOKEN_ID": "modal-id",
    "MODAL_TOKEN_SECRET": "modal-secret",
    "R2_ACCESS_KEY_ID": "r2-id",
    "R2_SECRET_ACCESS_KEY": "r2-secret",
    "MODAL_PROXY_TOKEN_ID": "wk-proxy",
    "MODAL_PROXY_TOKEN_SECRET": "ws-proxy",
    "WORKERS_SUBDOMAIN": "parfocal",
    "PREVIEW_ZITADEL_ISSUER": "https://issuer.example",
    "PREVIEW_ZITADEL_CLIENT_ID": "preview-client",
    "PREVIEW_ZITADEL_CLIENT_SECRET": "preview-client-secret",
    "PREVIEW_ZITADEL_LOGIN_TOKEN": "preview-login-token",
}


def owner_uri(host: str) -> str:
    login = ":".join(["neondb_owner", "owner-word"])
    return f"postgresql://{login}@{host}/neondb?sslmode=require"


@dataclass
class Cloud:
    branches: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"id": "br-main", "name": "main", "default": True, "protected": False},
            {"id": "br-dev", "name": "dev", "default": False, "protected": False},
        ]
    )
    environments: list[str] = field(default_factory=lambda: ["main", "dev"])
    secrets: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)
    workers: list[str] = field(default_factory=lambda: ["parfocal-edge", "parfocal-edge-dev"])
    objects: list[str] = field(
        default_factory=lambda: ["fixtures/CMU-1.svs", "t/one/s/two/original.svs"]
    )
    open_numbers: list[int] = field(default_factory=list)
    gh_fails: bool = False
    roles: set[str] = field(default_factory=set)
    commands: list[tuple[tuple[str, ...], dict[str, str]]] = field(default_factory=list)
    neon_calls: list[tuple[str, str, Any]] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    def neon(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        self.neon_calls.append((method, path, body))
        if method == "POST":
            assert body is not None
            created = {"id": f"br-{body['branch']['name']}", **body["branch"]}
            self.branches.append(created)
            return {"branch": created}
        if method == "PATCH":
            return {}
        if method == "DELETE":
            branch_id = path.rsplit("/", 1)[1]
            self.branches = [branch for branch in self.branches if branch["id"] != branch_id]
            self.deleted.append(f"neon:{branch_id}")
            return {}
        if path.endswith("/branches"):
            return {"branches": [dict(branch) for branch in self.branches]}
        if path.endswith("/databases"):
            return {"databases": [{"name": "neondb", "owner_name": "neondb_owner"}]}
        suffix = "-pooler" if "pooled=true" in path else ""
        return {"uri": owner_uri(f"ep-quiet{suffix}.eu-central-1.aws.neon.tech")}

    def sql(self, uri: str, statement: str) -> list[Any]:
        if statement == neon.ROLE_EXISTS:
            return [1] if neon.APP_ROLE in self.roles else []
        if statement.startswith("CREATE ROLE"):
            self.roles.add(neon.APP_ROLE)
        if "alembic_version" in statement:
            return [(False,)]
        return []

    def read(self, argv: Sequence[str]) -> str:
        if argv[0] == "gh":
            if self.gh_fails:
                raise RuntimeError("gh is offline")
            return json.dumps([{"number": number} for number in self.open_numbers])
        if "environment" in argv:
            return json.dumps([{"name": name} for name in self.environments])
        environment = argv[argv.index("-e") + 1]
        return json.dumps([{"Name": name} for name in self.secrets.get(environment, {})])

    def run(self, argv: Sequence[str], stdin: str | None, extra: Mapping[str, str] | None) -> None:
        self.commands.append((tuple(argv), dict(extra or {})))
        if "environment" in argv and "create" in argv:
            self.environments.append(argv[-1])
        if "environment" in argv and "delete" in argv:
            name = argv[argv.index("delete") + 1]
            self.environments.remove(name)
            self.secrets.pop(name, None)
            self.deleted.append(f"modal:{name}")
        if "secret" in argv and "delete" in argv:
            name = argv[argv.index("delete") + 1]
            environment = argv[argv.index("-e") + 1]
            assert environment.startswith("pr-")
            del self.secrets[environment][name]
        if "secret" in argv and "create" in argv:
            name = argv[argv.index("create") + 1]
            environment = argv[argv.index("-e") + 1]
            assert environment in self.environments
            path = Path(argv[argv.index("--from-json") + 1])
            self.secrets.setdefault(environment, {})[name] = json.loads(path.read_text())

    def fetch(self, url: str) -> tuple[int, Mapping[str, str]]:
        if url.endswith("/api/health"):
            return 200, {**ISOLATION_HEADERS, "content-type": "application/json"}
        return 200, secured_page_headers()

    def cloudflare(self, method: str, path: str) -> tuple[int, dict[str, Any]]:
        if method == "GET":
            return 200, {"result": [{"id": name} for name in self.workers]}
        name = path.split("/scripts/")[1].split("?")[0]
        if name not in self.workers:
            return 404, {}
        self.workers.remove(name)
        self.deleted.append(f"worker:{name}")
        return 200, {}

    def list_keys(self, prefix: str) -> list[str]:
        return [key for key in self.objects if key.startswith(prefix)]

    def delete(self, key: str) -> None:
        self.objects.remove(key)
        self.deleted.append(f"object:{key}")

    def tools(self) -> Tools:
        return Tools(run=self.run, read=self.read, sql=self.sql, neon=self.neon, fetch=self.fetch)


def keys() -> str:
    return "k" * 43


def created(cloud: Cloud, number: int) -> None:
    create(
        number,
        cloud.tools(),
        LOCAL,
        web_url=lambda _: "https://api.modal.example",
        make=keys,
        now=NOW,
    )


def lines(cloud: Cloud) -> list[str]:
    return [" ".join(argv) for argv, _ in cloud.commands]


def test_names_come_only_from_a_positive_pull_request_number() -> None:
    chosen = names(42)
    assert chosen.worker == "parfocal-edge-pr-42"
    assert chosen.modal_environment == "pr-42"
    assert chosen.neon_branch == "pr-42"
    assert chosen.storage_prefix == "previews/pr-42/"
    assert names("42") == chosen
    for bad in (0, -1, "main", "", "4 2", "42/", "../1", True, 1.5, None, "01"):
        with pytest.raises(BadNumberError):
            names(bad)


def test_every_guard_refuses_main_fixtures_and_any_other_pull_request() -> None:
    for name in ("main", "parfocal-edge", "parfocal-edge-dev", "", "parfocal-edge-pr-10"):
        with pytest.raises(RefusedError):
            guard_worker(name, 1)
    for name in ("main", "dev", "", "pr-10", "pr-1 ", "PR-1"):
        with pytest.raises(RefusedError):
            guard_modal_environment(name, 1)
    for prefix in ("fixtures/", "", "previews/", "previews/pr-1", "previews/pr-10/", "t/"):
        with pytest.raises(RefusedError):
            guard_prefix(prefix, 1)
    for key in ("fixtures/CMU-1.svs", "previews/pr-10/t/x", "previews/pr-1/", "t/one/x"):
        with pytest.raises(RefusedError):
            guard_key(key, "previews/pr-1/", 1)
    assert guard_worker("parfocal-edge-pr-1", 1) == "parfocal-edge-pr-1"
    assert guard_modal_environment("pr-1", 1) == "pr-1"
    assert guard_prefix("previews/pr-1/", 1) == "previews/pr-1/"


def test_the_neon_guard_refuses_main_and_any_default_or_protected_branch() -> None:
    refused = (
        {"id": "br-main", "name": "main", "default": True},
        {"id": "br-x", "name": "main"},
        {"id": "br-x", "name": "pr-1", "default": True},
        {"id": "br-x", "name": "pr-1", "protected": True},
        {"id": "br-x", "name": "pr-1", "primary": True},
        {"id": "br-x", "name": "pr-10"},
        {"id": "br-x", "name": "base"},
    )
    for branch in refused:
        with pytest.raises(RefusedError):
            guard_neon_branch(branch, 1)
    assert guard_neon_branch({"id": "br-pr-1", "name": "pr-1"}, 1) == "br-pr-1"


def test_a_new_preview_gets_a_branch_environment_secrets_deploy_and_seed() -> None:
    cloud = Cloud()
    created(cloud, 7)
    post = next(call for call in cloud.neon_calls if call[0] == "POST")
    assert post[2]["branch"] == {
        "name": "pr-7",
        "parent_id": "br-main",
        "expires_at": "2026-11-23T12:00:00Z",
    }
    assert "pr-7" in cloud.environments
    assert set(cloud.secrets["pr-7"]) == {KEYS_SECRET, CONFIG_SECRET, LOGIN_SECRET}
    config = cloud.secrets["pr-7"][CONFIG_SECRET]
    assert config["APP_ENV"] == "preview"
    assert config["STORAGE_BUCKET"] == "parfocal-dev"
    assert config["STORAGE_KEY_PREFIX"] == "previews/pr-7/"
    assert config["PUBLIC_ORIGIN"] == "https://parfocal-edge-pr-7.parfocal.workers.dev"
    assert config["ZITADEL_CLIENT_ID"] == "preview-client"
    commands = lines(cloud)
    assert any(line.endswith("modal environment create pr-7") for line in commands)
    assert any(
        line.endswith("modal deploy -e pr-7 -m parfocal_deploy.modal_app") for line in commands
    )
    assert not any("modal_pool" in line for line in commands)
    assert not any("modal deploy -e main" in line for line in commands)
    edge = next(line for line in commands if "wrangler deploy" in line)
    assert "--name parfocal-edge-pr-7" in edge
    assert "--env" not in edge
    assert "--var STORAGE_PREFIX:previews/pr-7/" in edge
    bulk = next(line for line in commands if "secret bulk" in line)
    assert bulk.endswith("--name parfocal-edge-pr-7")
    seed_extra = next(extra for argv, extra in cloud.commands if "parfocal_api.showcase" in argv)
    assert seed_extra["STORAGE_KEY_PREFIX"] == "previews/pr-7/"
    assert seed_extra["APP_ENV"] == "preview"


def test_a_branch_that_expired_gets_a_new_role_and_new_keys_on_the_next_push() -> None:
    cloud = Cloud()
    created(cloud, 7)
    first_keys = cloud.secrets["pr-7"][KEYS_SECRET]
    cloud.branches = [branch for branch in cloud.branches if branch["name"] != "pr-7"]
    cloud.roles.clear()
    cloud.commands.clear()
    create(
        7,
        cloud.tools(),
        LOCAL,
        web_url=lambda _: "https://api.modal.example",
        make=lambda: "z" * 43,
        now=NOW,
    )
    assert neon.APP_ROLE in cloud.roles
    assert cloud.secrets["pr-7"][KEYS_SECRET] != first_keys
    assert any(line.endswith(f"secret delete {KEYS_SECRET} -e pr-7 --yes") for line in lines(cloud))


def test_a_push_to_an_open_preview_moves_the_expiry_keeps_the_keys_and_seeds_again() -> None:
    cloud = Cloud()
    created(cloud, 7)
    first_keys = cloud.secrets["pr-7"][KEYS_SECRET]
    cloud.commands.clear()
    cloud.neon_calls.clear()
    create(
        7,
        cloud.tools(),
        LOCAL,
        web_url=lambda _: "https://api.modal.example",
        make=lambda: "z" * 43,
        now=NOW,
    )
    assert [call[0] for call in cloud.neon_calls if call[0] in {"POST", "PATCH"}] == ["PATCH"]
    assert cloud.secrets["pr-7"][KEYS_SECRET] == first_keys
    assert any("parfocal_api.showcase" in argv for argv, _ in cloud.commands)
    assert not any("environment create" in line for line in lines(cloud))
    assert not any("secret delete" in line for line in lines(cloud))


def test_a_sixth_preview_is_refused_before_anything_is_created() -> None:
    cloud = Cloud()
    cloud.branches += [{"id": f"br-pr-{n}", "name": f"pr-{n}"} for n in range(1, 6)]
    with pytest.raises(PreviewLimitError):
        created(cloud, 9)
    assert cloud.commands == []
    assert "pr-9" not in cloud.environments


def test_create_names_every_missing_setting_before_touching_anything() -> None:
    cloud = Cloud()
    with pytest.raises(MissingSettingsError, match="WORKERS_SUBDOMAIN"):
        create(3, cloud.tools(), {**LOCAL, "WORKERS_SUBDOMAIN": ""})
    assert cloud.neon_calls == []
    assert cloud.commands == []


def test_teardown_deletes_only_what_carries_its_own_pull_request_name() -> None:
    cloud = Cloud()
    created(cloud, 1)
    created(cloud, 10)
    cloud.workers += ["parfocal-edge-pr-1", "parfocal-edge-pr-10"]
    cloud.objects += ["previews/pr-1/t/a/s/b/original.svs", "previews/pr-10/t/c/s/d/original.svs"]
    cloud.deleted.clear()
    removed = teardown(1, cloud.tools(), cloud.cloudflare, cloud, LOCAL)
    assert removed == preview.Removed(
        worker=True, modal_environment=True, neon_branch=True, objects=1
    )
    assert sorted(cloud.deleted) == [
        "modal:pr-1",
        "neon:br-pr-1",
        "object:previews/pr-1/t/a/s/b/original.svs",
        "worker:parfocal-edge-pr-1",
    ]
    assert {"main", "dev", "pr-10"} <= set(cloud.environments)
    assert {branch["name"] for branch in cloud.branches} == {"main", "dev", "pr-10"}
    assert {"parfocal-edge", "parfocal-edge-dev", "parfocal-edge-pr-10"} <= set(cloud.workers)
    assert "fixtures/CMU-1.svs" in cloud.objects
    assert "t/one/s/two/original.svs" in cloud.objects
    assert "previews/pr-10/t/c/s/d/original.svs" in cloud.objects


def test_a_second_teardown_finds_nothing_and_still_succeeds() -> None:
    cloud = Cloud()
    first = teardown(4, cloud.tools(), cloud.cloudflare, cloud, LOCAL)
    assert first == preview.Removed(
        worker=False, modal_environment=False, neon_branch=False, objects=0
    )
    assert cloud.deleted == []


def test_teardown_refuses_a_branch_neon_marks_protected_even_with_the_right_name() -> None:
    cloud = Cloud()
    cloud.branches.append({"id": "br-pr-2", "name": "pr-2", "protected": True})
    with pytest.raises(RefusedError):
        teardown(2, cloud.tools(), cloud.cloudflare, cloud, LOCAL)
    assert "neon:br-pr-2" not in cloud.deleted


def test_the_sweep_removes_previews_of_closed_pull_requests_only() -> None:
    cloud = Cloud(open_numbers=[3])
    created(cloud, 3)
    created(cloud, 8)
    cloud.workers += ["parfocal-edge-pr-3", "parfocal-edge-pr-8", "parfocal-edge-pr-12"]
    cloud.objects += ["previews/pr-3/t/x", "previews/pr-8/t/y"]
    removed = sweep(cloud.tools(), cloud.cloudflare, cloud, LOCAL)
    assert sorted(removed) == [8, 12]
    assert "pr-3" in cloud.environments
    assert "parfocal-edge-pr-3" in cloud.workers
    assert "previews/pr-3/t/x" in cloud.objects
    assert "pr-8" not in cloud.environments
    assert {"main", "dev"} <= set(cloud.environments)
    assert {"main", "dev", "pr-3"} == {branch["name"] for branch in cloud.branches}


def test_the_sweep_does_nothing_when_open_pull_requests_cannot_be_listed() -> None:
    cloud = Cloud(gh_fails=True)
    created(cloud, 8)
    cloud.deleted.clear()
    with pytest.raises(RuntimeError):
        sweep(cloud.tools(), cloud.cloudflare, cloud, LOCAL)
    assert cloud.deleted == []


def workflow(name: str) -> str:
    return (REPOSITORY / ".github/workflows" / name).read_text()


def test_the_preview_workflow_runs_only_for_same_repository_pull_requests_behind_a_switch() -> None:
    text = workflow("preview.yml")
    assert "pull_request_target" not in text
    assert "types: [opened, reopened, synchronize]" in text
    assert "github.event.pull_request.head.repo.full_name == github.repository" in text
    assert "vars.PREVIEWS == 'true'" in text
    assert "environment: preview" in text
    assert "cancel-in-progress: true" in text
    assert "secrets.NEON_API_KEY" in text
    assert "vars.PREVIEW_NEON_PROJECT_ID" in text


def test_the_teardown_workflow_runs_on_close_and_every_night() -> None:
    text = workflow("preview-teardown.yml")
    assert "pull_request_target" not in text
    assert "types: [closed]" in text
    assert "schedule:" in text
    assert "preview teardown --pr" in text
    assert "preview sweep" in text
    assert "environment: preview" in text
