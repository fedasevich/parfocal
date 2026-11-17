import json
import re
import shlex
import sys
from collections.abc import Callable
from pathlib import Path
from typing import cast

CLOUD_SERVERS = ("neon", "cloudflare", "vercel", "resend", "sentry", "posthog")
SHELL_TOOLS = ("mcp__webstorm__execute_terminal_command",)
DESTRUCTIVE_VERBS = frozenset(
    {
        "delete",
        "remove",
        "reset",
        "restore",
        "rotate",
        "revoke",
        "purge",
        "destroy",
        "drop",
        "disable",
        "rollback",
        "pause",
        "replace",
        "buy",
        "transfer",
    }
)
SAFE_MCP_TOOLS = frozenset({"get_project_deletion_link"})
OPERATOR_CHARS = frozenset("();<>|&\n")
HEREDOC = re.compile(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")
SHELLS = frozenset({"bash", "sh", "zsh"})
RUNNERS = frozenset({"sudo", "env", "time", "nohup", "command", "exec", "npx", "uvx", "bunx"})
PACKAGE_RUNNERS = frozenset({"pnpm", "yarn", "npm", "uv", "bun"})
RUN_VERBS = (["exec"], ["dlx"], ["run"], ["x"])
SAFE_MODAL_ENVS = frozenset({"dev", "staging"})
LOCAL_URL = re.compile(r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)")
GH_FOR_GOOD = (
    ["repo", "delete"],
    ["repo", "archive"],
    ["variable", "delete"],
    ["ruleset", "delete"],
)
GH_GROUPS = frozenset({"repo", "variable", "ruleset", "secret", "api"})
MAX_SCRIPT_BYTES = 200_000
MAX_DEPTH = 3

ADVICE = (
    "SEC-031 (hard stops for destructive agent actions) refuses this for every agent. Deleting, "
    "destroying, purging, rotating or resetting cloud resources is the owner's to run, as ADR 0115 "
    "(production access and spend caps) and ADR 0151 (standing approval within $30 a month) say. "
    "Write the exact command and its cost in chat or docs/decisions.md and let the owner run it in "
    "their own terminal or dashboard. See docs/knowledge/agent-tooling.md."
)


def tool_verbs(name: str) -> set[str]:
    return set(re.split(r"[_\-]", name.lower()))


def refuse_mcp(tool_name: str) -> str | None:
    parts = tool_name.split("__", 2)
    if len(parts) != 3:
        return None
    server, name = parts[1].lower(), parts[2].lower()
    if not server.startswith(CLOUD_SERVERS) or name in SAFE_MCP_TOOLS:
        return None
    hits = tool_verbs(name) & DESTRUCTIVE_VERBS
    if hits or name == "set_default_branch":
        return f"{tool_name} changes or removes a cloud resource"
    return None


def words(command: str) -> list[str]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars="();<>|&\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return command.replace("\n", " \n ").split(" ")


def split_heredocs(command: str) -> tuple[str, list[tuple[str, str]]]:
    kept: list[str] = []
    bodies: list[tuple[str, str]] = []
    lines = command.split("\n")
    index = 0
    while index < len(lines):
        line = lines[index]
        kept.append(line)
        index += 1
        marker = HEREDOC.search(line)
        if marker is None:
            continue
        body: list[str] = []
        while index < len(lines) and lines[index].strip() != marker.group(1):
            body.append(lines[index])
            index += 1
        index += 1
        bodies.append((line, "\n".join(body)))
    return "\n".join(kept), bodies


def segments(command: str) -> list[list[str]]:
    found: list[list[str]] = []
    current: list[str] = []
    for word in words(command):
        if word and set(word) <= OPERATOR_CHARS:
            if current:
                found.append(current)
            current = []
        else:
            current.append(word)
    if current:
        found.append(current)
    return found


def drop_flags(argv: list[str]) -> list[str]:
    while argv and argv[0].startswith("-"):
        argv = argv[1:]
    return argv


def program_name(word: str) -> str:
    name = Path(word).name
    return name.split("@", 1)[0] if not name.startswith("@") else name


def known(word: str) -> bool:
    name = program_name(word)
    return name in PROGRAMS or name in SHELLS or name in RUNNERS


def after_runner(argv: list[str]) -> list[str]:
    for index, word in enumerate(argv):
        if known(word):
            return argv[index:]
    return drop_flags(argv)


def unwrap(argv: list[str]) -> tuple[list[str], dict[str, str]]:
    env: dict[str, str] = {}
    while argv:
        head = argv[0]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", head):
            key, _, value = head.partition("=")
            env[key] = value
            argv = argv[1:]
        elif program_name(head) in RUNNERS:
            argv = after_runner(argv[1:])
        elif program_name(head) in PACKAGE_RUNNERS and argv[1:2] in RUN_VERBS:
            argv = after_runner(argv[2:])
        else:
            break
    if argv:
        argv = [program_name(argv[0]), *argv[1:]]
    return argv, env


def positional(args: list[str]) -> list[str]:
    return [arg.lower() for arg in args if not arg.startswith("-")]


def following(plain: list[str], groups: frozenset[str]) -> list[str]:
    for index, word in enumerate(plain):
        if word in groups:
            return plain[index:]
    return []


def refuse_tofu(args: list[str], _env: dict[str, str]) -> str | None:
    lowered = [arg.lower() for arg in args]
    plain = positional(args)
    if "destroy" in plain:
        return "tofu destroy removes cloud resources"
    forcing = ("-destroy", "-replace", "--destroy", "--replace")
    if "apply" in plain and any(arg.startswith(forcing) for arg in lowered):
        return "tofu with -destroy or -replace removes or recreates cloud resources"
    if plain[:1] == ["taint"] or plain[:1] == ["force-unlock"]:
        return f"tofu {plain[0]} forces a resource or the state"
    if plain[:2] in (["state", "rm"], ["state", "push"], ["state", "mv"], ["workspace", "delete"]):
        return f"tofu {' '.join(plain[:2])} rewrites the state"
    return None


def refuse_tofu_wrapper(args: list[str], env: dict[str, str]) -> str | None:
    return refuse_tofu(args[1:], env)


def refuse_wrangler(args: list[str], _env: dict[str, str]) -> str | None:
    hits = set(positional(args)) & {"delete", "remove", "purge", "rollback", "rm"}
    return f"wrangler {sorted(hits)[0]} removes a Cloudflare resource" if hits else None


def modal_env(args: list[str], env: dict[str, str]) -> str:
    chosen = env.get("MODAL_ENVIRONMENT", "main")
    for index, arg in enumerate(args):
        if arg in ("-e", "--env") and index + 1 < len(args):
            chosen = args[index + 1]
        elif arg.startswith("--env="):
            chosen = arg.partition("=")[2]
    return chosen.lower()


def refuse_modal(args: list[str], env: dict[str, str]) -> str | None:
    hits = set(positional(args)) & {"stop", "delete", "rm", "remove", "rollback"}
    if not hits or modal_env(args, env) in SAFE_MODAL_ENVS:
        return None
    return f"modal {sorted(hits)[0]} outside dev and staging reaches production"


def refuse_neonctl(args: list[str], _env: dict[str, str]) -> str | None:
    hits = set(positional(args)) & {"delete", "reset", "restore", "reset-password", "set-default"}
    return f"neonctl {sorted(hits)[0]} removes or rewinds Neon data" if hits else None


def refuse_vercel(args: list[str], _env: dict[str, str]) -> str | None:
    hits = set(positional(args)) & {"remove", "rm", "delete", "rollback"}
    return f"vercel {sorted(hits)[0]} removes a Vercel resource" if hits else None


def only_tenant_prefix(targets: list[str]) -> bool:
    remote = [target for target in targets if target.startswith("s3://")]
    return bool(remote) and all(re.fullmatch(r"s3://[^/]+/t/.*", target) for target in remote)


def refuse_aws(args: list[str], _env: dict[str, str]) -> str | None:
    command = following(positional(args), frozenset({"s3", "s3api"}))
    if command[:2] == ["s3", "rb"]:
        return "aws s3 rb deletes a bucket"
    if command[:2] == ["s3", "rm"] and not only_tenant_prefix(command[2:]):
        return "aws s3 rm deletes objects outside the tenant prefix t/"
    if command[:1] == ["s3api"] and len(command) > 1 and command[1].startswith("delete-"):
        return f"aws s3api {command[1]} deletes bucket data or settings"
    return None


def refuse_rclone(args: list[str], _env: dict[str, str]) -> str | None:
    hits = set(positional(args)) & {"purge", "delete", "deletefile", "rmdir", "rmdirs"}
    return f"rclone {sorted(hits)[0]} deletes remote objects" if hits else None


def http_method(args: list[str]) -> str:
    for index, arg in enumerate(args):
        if arg in ("-X", "--request") and index + 1 < len(args):
            return args[index + 1].upper()
        if arg.startswith("-X") and len(arg) > 2:
            return arg[2:].upper()
        if arg.startswith("--request="):
            return arg.partition("=")[2].upper()
        if arg.startswith("--method="):
            return arg.partition("=")[2].upper()
        if arg == "--method" and index + 1 < len(args):
            return args[index + 1].upper()
    return "GET"


def refuse_gh(args: list[str], _env: dict[str, str]) -> str | None:
    command = following(positional(args), GH_GROUPS)
    if command[:2] in GH_FOR_GOOD:
        return f"gh {' '.join(command[:2])} changes the repository for good"
    if command[:1] == ["secret"] and len(command) > 1 and command[1] in ("delete", "remove"):
        return "gh secret delete removes a repository secret"
    if command[:1] == ["api"] and http_method(args) == "DELETE":
        return "gh api DELETE removes a GitHub resource"
    return None


def refuse_curl(args: list[str], _env: dict[str, str]) -> str | None:
    if http_method(args) != "DELETE":
        return None
    urls = [arg for arg in args if re.match(r"https?://", arg)]
    if any(not LOCAL_URL.match(url) for url in urls):
        return "curl DELETE against a remote service"
    return None


OWNED_PROJECTS = frozenset({"parfocal-zitadel"})
OWNED_VOLUME = re.compile(r"^parfocal-zitadel_")


def compose_project(args: list[str], env: dict[str, str]) -> str:
    chosen = env.get("COMPOSE_PROJECT_NAME", "parfocal")
    for index, arg in enumerate(args):
        if arg in ("-p", "--project-name") and index + 1 < len(args):
            chosen = args[index + 1]
        elif arg.startswith("--project-name="):
            chosen = arg.partition("=")[2]
    return chosen


def refuse_docker(args: list[str], env: dict[str, str]) -> str | None:
    plain = positional(args)
    removes_volumes = any(arg in ("-v", "--volumes") for arg in args)
    if plain[:1] == ["compose"] and "down" in plain and removes_volumes:
        project = compose_project(args, env)
        if project in OWNED_PROJECTS:
            return f"docker compose down -v deletes the owner's {project} volumes"
    if plain[:2] == ["volume", "prune"] or (plain[:2] == ["system", "prune"] and removes_volumes):
        return "docker prune deletes the owner's local volumes"
    if plain[:2] in (["volume", "rm"], ["volume", "remove"]):
        owned = [name for name in plain[2:] if OWNED_VOLUME.match(name)]
        if owned:
            return f"docker volume rm deletes the owner's volume {owned[0]}"
    return None


Rule = Callable[[list[str], dict[str, str]], str | None]

PROGRAMS: dict[str, Rule] = {
    "tofu": refuse_tofu,
    "terraform": refuse_tofu,
    "tofu.sh": refuse_tofu_wrapper,
    "wrangler": refuse_wrangler,
    "modal": refuse_modal,
    "neonctl": refuse_neonctl,
    "neon": refuse_neonctl,
    "vercel": refuse_vercel,
    "aws": refuse_aws,
    "rclone": refuse_rclone,
    "gh": refuse_gh,
    "curl": refuse_curl,
    "docker": refuse_docker,
}


def script_text(path: str) -> str | None:
    file = Path(path)
    try:
        if file.is_file() and file.stat().st_size <= MAX_SCRIPT_BYTES:
            return file.read_text(errors="replace")
    except OSError:
        return None
    return None


def refuse_shell(args: list[str], depth: int) -> str | None:
    if "-c" in args:
        index = args.index("-c")
        if index + 1 < len(args):
            return refuse_command(args[index + 1], depth + 1)
        return None
    plain = drop_flags(args)
    if plain:
        rule = PROGRAMS.get(program_name(plain[0]))
        reason = rule(plain[1:], {}) if rule else None
        if reason:
            return reason
        text = script_text(plain[0])
        if text is not None:
            return refuse_command(text, depth + 1)
    return None


def refuse_command(command: str, depth: int = 0) -> str | None:
    if depth > MAX_DEPTH:
        return None
    text, bodies = split_heredocs(command.replace("\\\n", " "))
    for opener, body in bodies:
        if any(Path(word).name in SHELLS for word in words(opener)):
            reason = refuse_command(body, depth + 1)
            if reason:
                return reason
    code = "\n".join(line for line in text.split("\n") if not line.lstrip().startswith("#"))
    for segment in segments(code):
        argv, env = unwrap(segment)
        if not argv:
            continue
        program, args = argv[0], argv[1:]
        if program in SHELLS:
            reason = refuse_shell(args, depth)
        elif program in PROGRAMS:
            reason = PROGRAMS[program](args, env)
        else:
            reason = None
        if reason:
            return reason
    return None


def refusal(event: dict[str, object]) -> str | None:
    tool_name = str(event.get("tool_name", ""))
    raw_input = event.get("tool_input")
    tool_input = cast("dict[str, object]", raw_input) if isinstance(raw_input, dict) else {}
    if tool_name == "Bash" or tool_name in SHELL_TOOLS:
        return refuse_command(str(tool_input.get("command", "")))
    if tool_name.startswith("mcp__"):
        return refuse_mcp(tool_name)
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return 0
    reason = refusal(event if isinstance(event, dict) else {})
    if reason is None:
        return 0
    print(f"Refused: {reason}. {ADVICE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
