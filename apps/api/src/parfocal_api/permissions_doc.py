import sys
from pathlib import Path

from parfocal_api.permissions import (
    COLUMNS,
    GRANT_NAMES,
    MATRIX,
    PERMISSION_NAMES,
    PROJECT_COLUMNS,
    PROJECT_MATRIX,
    PROJECT_ROLE_NAMES,
    ROLE_NAMES,
    Grant,
)

DOC_PATH = Path(__file__).resolve().parents[4] / "docs" / "reference" / "permissions.md"


def cell(grant: Grant) -> str:
    return "" if grant is Grant.NONE else GRANT_NAMES[grant]


def render() -> str:
    rows = [
        f"| {PERMISSION_NAMES[permission]}"
        f" | `{permission.value}` | " + " | ".join(cell(grants[role]) for role in COLUMNS) + " |"
        for permission, grants in MATRIX.items()
    ]
    header = "| Action | Key | " + " | ".join(ROLE_NAMES[role] for role in COLUMNS) + " |"
    divider = "|---|---|" + "---|" * len(COLUMNS)
    roles = [f"| `{role.value}` | {ROLE_NAMES[role]} |" for role in COLUMNS]
    project_roles = [f"| `{role.value}` | {name} |" for role, name in PROJECT_ROLE_NAMES.items()]
    project_header = "| Action | Key | " + " | ".join(role.value for role in PROJECT_COLUMNS) + " |"
    project_divider = "|---|---|" + "---|" * len(PROJECT_COLUMNS)
    project_rows = [
        f"| {PERMISSION_NAMES[permission]} | `{permission.value}` | "
        + " | ".join(cell(grants[role]) for role in PROJECT_COLUMNS)
        + " |"
        for permission, grants in PROJECT_MATRIX.items()
    ]
    return "\n".join(
        [
            "# Permissions",
            "",
            "Generated from `apps/api/src/parfocal_api/permissions.py` by `pnpm permissions:doc`.",
            "Edit the matrix there, never this page. "
            "[ADR 0061](../adr/0061-researcher-reviewer-and-admin-roles.md) explains it.",
            "",
            "## Roles",
            "",
            "| Key | Role |",
            "|---|---|",
            *roles,
            "",
            "Platform operators sit outside the matrix and only reach `/api/platform/*`.",
            "",
            "## Project roles",
            "",
            "A member reaches a project only with one of these roles. Service accounts reach "
            "every project of their workspace through their scopes.",
            "",
            "| Key | Project role |",
            "|---|---|",
            *project_roles,
            "",
            "Inside a project the narrower of the workspace grant and the project grant applies. "
            "A workspace grant of in their tasks with a project grant of yes reads the project "
            "without changing it.",
            "",
            project_header,
            project_divider,
            *project_rows,
            "",
            "## Matrix",
            "",
            "An empty cell means no.",
            "",
            header,
            divider,
            *rows,
            "",
        ]
    )


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DOC_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render())


if __name__ == "__main__":
    main()
