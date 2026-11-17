import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from guard_destructive import refusal

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "guard_destructive.py"

KNOWN_REFUSED_SCRIPTS: set[str] = set()

REFUSED_TOOLS = (
    "mcp__neon__delete_project",
    "mcp__neon__delete_branch",
    "mcp__neon__delete_postgres_database",
    "mcp__neon__reset_from_parent",
    "mcp__neon__restore_snapshot",
    "mcp__neon__finalize_branch_restore",
    "mcp__neon__rotate_credential",
    "mcp__neon__revoke_credential",
    "mcp__neon__reset_postgres_role_password",
    "mcp__neon__set_default_branch",
    "mcp__neon__disable_auth",
    "mcp__cloudflare-bindings__r2_bucket_delete",
    "mcp__cloudflare-bindings__kv_namespace_delete",
    "mcp__cloudflare-bindings__d1_database_delete",
    "mcp__cloudflare-api__r2_bucket_delete",
    "mcp__vercel__delete_sandbox",
    "mcp__vercel__delete_drive",
    "mcp__vercel__pause_project",
    "mcp__vercel__request_rollback",
    "mcp__vercel__replace_domain_dns_records",
    "mcp__vercel__buy_domain",
    "mcp__vercel__restore_edge_config_backup",
    "mcp__resend__remove-domain",
    "mcp__resend__remove-api-key",
    "mcp__resend__batch-remove-suppressions",
    "mcp__resend__rotate-webhook-signing-secret",
    "mcp__resend__revoke-oauth-grant",
)

ALLOWED_TOOLS = (
    "mcp__neon__create_branch",
    "mcp__neon__list_projects",
    "mcp__neon__run_sql",
    "mcp__neon__restart_postgres_endpoint",
    "mcp__neon__recover_project",
    "mcp__neon__prepare_database_migration",
    "mcp__vercel__create_deployment",
    "mcp__vercel__get_project_deletion_link",
    "mcp__vercel__get_runtime_logs",
    "mcp__resend__send-email",
    "mcp__resend__list-domains",
    "mcp__cloudflare-docs__search_cloudflare_documentation",
    "mcp__webstorm__delete_changelist",
    "mcp__claude-artifacts__delete_artifact",
)

REFUSED_COMMANDS = (
    "docker compose -p parfocal-zitadel -f infra/local/zitadel.compose.yaml down -v",
    "docker compose --project-name=parfocal-zitadel down --volumes",
    "docker volume rm parfocal-zitadel_zitadel-db",
    "docker volume prune -f",
    "docker system prune -a --volumes",
    "tofu destroy",
    "tofu -chdir=infra/tofu/prod destroy -auto-approve",
    "tofu apply -destroy",
    "tofu apply -replace=cloudflare_r2_bucket.prod",
    "terraform state rm cloudflare_r2_bucket.dev",
    "bash infra/tofu/tofu.sh prod destroy",
    "infra/tofu/tofu.sh dev apply -replace=x",
    "cd ~ && npx wrangler r2 bucket delete parfocal-prod",
    "npx wrangler kv namespace delete --namespace-id abc",
    "wrangler r2 object delete parfocal-dev/slide.svs",
    "pnpm exec wrangler delete parfocal-edge",
    "uvx modal app stop parfocal-api",
    "uvx modal app stop parfocal-api --env main",
    "modal volume rm models weights.pt",
    "MODAL_ENVIRONMENT=main modal app stop parfocal-api",
    "npx neonctl branches delete br-main --org-id org-blue",
    "neonctl branches reset dev --parent",
    "neonctl roles reset-password owner",
    "vercel remove parfocal --yes",
    "aws s3 rb s3://parfocal-prod --force",
    "aws s3 rm s3://parfocal-dev --recursive",
    "aws s3api delete-bucket --bucket parfocal-dev",
    "rclone purge r2:parfocal-dev",
    "gh repo delete fedasevich/parfocal --yes",
    "gh secret delete CLOUDFLARE_API_TOKEN",
    "gh api -X DELETE repos/fedasevich/parfocal/environments/staging",
    "curl -X DELETE https://api.cloudflare.com/client/v4/accounts/a/r2/buckets/parfocal-dev",
    "echo ok; tofu destroy",
    "bash -c 'tofu destroy -auto-approve'",
    "sudo env FOO=1 tofu destroy",
    "bash <<'EOF'\nnpx wrangler r2 bucket delete parfocal-dev\nEOF",
    "npx wrangler r2 bucket \\\n  delete parfocal-dev",
    "gh api \\\n  -X DELETE repos/fedasevich/parfocal/environments/staging",
    "aws --endpoint-url https://a.r2.cloudflarestorage.com s3 rm s3://parfocal-dev --recursive",
    "aws --profile r2 s3api delete-bucket --bucket parfocal-dev",
    "rclone --config r2.conf purge r2:parfocal-dev",
    "gh -R fedasevich/parfocal secret delete NEON_API_KEY",
    "uv run --package parfocal-api modal app stop parfocal-api",
    "npx wrangler@latest r2 bucket delete parfocal-dev",
    "npx -y neonctl@2 branches delete br-main",
)

ALLOWED_COMMANDS = (
    "docker compose -p af72 -f compose.yaml down -v",
    "docker compose -p parfocal-zitadel -f infra/local/zitadel.compose.yaml down",
    "docker volume rm af72_postgres18-data",
    "docker ps -a",
    "git merge --no-ff worktree-agent-a",
    "git push origin main",
    "git branch -D worktree-agent-a",
    "git worktree remove --force .claude/worktrees/agent-a",
    'git commit -m "feat(SEC-031): Refuse tofu destroy and modal app stop"',
    "git commit -m \"$(cat <<'EOF'\nfeat(SEC-031): Hard stops\n\ntofu destroy is refused\nEOF\n)\"",
    'git commit -m "feat(SEC-031): Hard stops\n\nneonctl branches delete is refused"',
    'grep -rn "tofu destroy" docs/',
    "rm -rf node_modules apps/web/dist",
    "rm -rf /tmp/parfocal-shot",
    "docker compose down -v",
    "docker compose up -d db",
    "pnpm -s verify",
    "pnpm --filter @parfocal/web exec playwright test e2e/home.spec.ts --workers=1",
    "uv run pytest apps/api",
    "uv sync",
    "tofu plan",
    "bash infra/tofu/tofu.sh prod apply",
    "bash infra/tofu/tofu.sh dev plan -out=plan.bin",
    "uvx modal deploy workers/api/app.py",
    "uvx modal app stop parfocal-test --env dev",
    "modal volume rm scratch tmp.bin -e staging",
    "uvx modal app list",
    "npx wrangler deploy",
    "npx wrangler r2 object get parfocal-dev/a.svs",
    "npx neonctl branches create --name tmp",
    "npx neonctl branches list",
    "aws s3 rm s3://parfocal-dev/t/ --recursive",
    "aws s3 ls s3://parfocal-dev",
    "gh pr merge 12 --squash",
    "gh run cancel 123",
    "gh api repos/fedasevich/parfocal/actions/runs",
    "curl -X DELETE http://localhost:8000/api/slides/1",
    "curl -fsS https://app.parfocal.eu/api/health",
    'curl -X DELETE "$API/slides/1"',
    "curl -X DELETE localhost:8000/api/slides/1",
    "tofu plan -destroy",
    "bash infra/tofu/tofu.sh prod plan -replace=cloudflare_r2_bucket.prod",
    "uv run --package parfocal-api pytest -k modal",
    "pnpm exec playwright test e2e/home.spec.ts --workers=1",
    "echo 'unbalanced",
    "# tofu destroy",
)


def bash(command: str) -> dict[str, object]:
    return {"tool_name": "Bash", "tool_input": {"command": command}}


class GuardDestructiveTest(unittest.TestCase):
    def test_refuses_destructive_cloud_tools(self) -> None:
        for name in REFUSED_TOOLS:
            self.assertIsNotNone(refusal({"tool_name": name, "tool_input": {}}), name)

    def test_allows_reading_and_additive_tools(self) -> None:
        for name in ALLOWED_TOOLS:
            self.assertIsNone(refusal({"tool_name": name, "tool_input": {}}), name)

    def test_refuses_destructive_cloud_commands(self) -> None:
        for command in REFUSED_COMMANDS:
            self.assertIsNotNone(refusal(bash(command)), command)

    def test_allows_local_work_and_additive_deploys(self) -> None:
        for command in ALLOWED_COMMANDS:
            self.assertIsNone(refusal(bash(command)), command)

    def test_checks_other_shell_tools(self) -> None:
        event = {
            "tool_name": "mcp__webstorm__execute_terminal_command",
            "tool_input": {"command": "tofu destroy"},
        }
        self.assertIsNotNone(refusal(event))

    def test_reads_scripts_run_through_a_shell(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "step.sh"
            script.write_text("set -e\ncd ~\nnpx wrangler r2 bucket delete parfocal-dev\n")
            self.assertIsNotNone(refusal(bash(f"bash {script}")))
            script.write_text("set -e\npnpm install\n")
            self.assertIsNone(refusal(bash(f"bash {script}")))

    def test_allows_every_shell_script_in_the_repo(self) -> None:
        tracked = subprocess.run(
            ["git", "ls-files", "*.sh"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
        self.assertTrue(tracked)
        refused = {path for path in tracked if refusal(bash(f"bash {ROOT / path}"))}
        self.assertEqual(refused, KNOWN_REFUSED_SCRIPTS)

    def test_hook_exits_two_with_advice(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(bash("tofu destroy")),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("owner", result.stderr)
        allowed = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps(bash("git push")),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(allowed.returncode, 0)

    def test_settings_run_the_guard_on_bash_and_mcp_tools(self) -> None:
        settings = json.loads((ROOT / ".claude" / "settings.json").read_text())
        entries = settings["hooks"]["PreToolUse"]
        matchers = [
            entry["matcher"]
            for entry in entries
            if any("guard_destructive.py" in hook["command"] for hook in entry["hooks"])
        ]
        self.assertEqual(len(matchers), 1)
        self.assertIn("Bash", matchers[0])
        self.assertIn("mcp__", matchers[0])

    def test_deprecated_cloudflare_servers_are_gone(self) -> None:
        servers = json.loads((ROOT / ".mcp.json").read_text())["mcpServers"]
        self.assertNotIn("cloudflare-bindings", servers)
        self.assertNotIn("cloudflare-observability", servers)


if __name__ == "__main__":
    unittest.main()
