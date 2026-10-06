# Log

Newest entries on top. One line per piece of work, naming the backlog ID where there is one and linking the result. This file is append-only.

## 2026-10-06

- Replaced relative POC references with full links. Code references in the backlog now link to the private GitHub repo, and [project/poc-reference.md](project/poc-reference.md) lists every POC doc with GitHub and local paths plus the clone command.
- Added a `.gitignore` for the TypeScript and Python monorepo (Node, Vite, Turborepo, Playwright, uv and Python caches, OpenTofu state, secrets, slide files and model weights) and renamed the default branch to `main`.
- Set up the docs memory system, the shared agent guide (`AGENTS.md`, imported by `CLAUDE.md`), ADR and result templates, and the project overview, roadmap and risk register. FOUND-002 and the template half of FOUND-003 are written but stay unticked until committed and, for FOUND-003, until the CI check exists. See [ADR 0001](adr/0001-docs-as-project-memory.md).
- Wrote the full backlog from the UX kit, the hi-fi mock and the POC docs after a planning session. 520 tasks in 37 epics, milestones M0 to M6. See [BACKLOG.md](BACKLOG.md) and [ADR 0002](adr/0002-planning-baseline.md).
