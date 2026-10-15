# Decision records

One file per decision, numbered in order. Copy [0000-template.md](0000-template.md) to start a new one. Accepted records are never rewritten. A change of course gets a new record that supersedes the old one.

Status is one of `Proposed`, `Accepted`, `Rejected` or `Superseded by NNNN`.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-docs-as-project-memory.md) | Keep project memory in `docs/` and share one agent guide | Accepted | 2026-10-06 |
| [0002](0002-planning-baseline.md) | Adopt the planning-session decisions as the baseline | Accepted | 2026-10-06 |
| [0003](0003-pilot-platform-architecture.md) | Pilot platform architecture on Cloudflare, Modal and Neon | Accepted | 2026-10-06 |
| [0004](0004-cloud-dev-resources.md) | Use free cloud resources in development instead of local emulators (replaces rule 5 of 0003) | Accepted | 2026-10-06 |
| [0005](0005-external-sends-only-in-production.md) | Send email, telemetry and analytics only from production (replaces four rows of 0004) | Accepted | 2026-10-06 |
| [0006](0006-monorepo-tooling.md) | Monorepo tooling: pnpm, Turborepo, TypeScript 7, Biome and type-aware Oxlint | Accepted | 2026-10-06 |
| [0007](0007-python-tooling.md) | Python 3.14 with uv, Ruff, basedpyright and pytest | Accepted | 2026-10-06 |
| [0008](0008-typescript-internal-packages.md) | TypeScript packages share source instead of project references | Accepted | 2026-10-06 |
| [0009](0009-quality-gates.md) | Quality gates: lefthook, betterleaks, type-aware Oxlint rules and solution-style tsconfigs | Accepted | 2026-10-06 |
| [0010](0010-ci-runners-and-suites.md) | GitHub Actions with hosted runners and a nightly self-hosted Mac GPU runner | Superseded by 0011 | 2026-10-06 |
| [0011](0011-hosted-ci-only.md) | Hosted CI runners only, no GPU-heavy test suites | Accepted | 2026-10-06 |
| [0012](0012-ux-round-2-prototype-revisions.md) | Prototype round 2: staging-first findings, quiet top bar, upload window and clearer compare | Accepted | 2026-10-07 |
| [0013](0013-cell-findings-shortcuts-and-ai-on-upload.md) | Prototype round 3: cell findings from zones of unsure cells, a neutral unsure colour, a shortcut editor and AI steps on upload | Accepted | 2026-10-07 |
| [0014](0014-conventional-commits-and-releases.md) | Conventional Commits with backlog scopes, and releases cut locally with git-cliff | Accepted | 2026-10-08 |
| [0015](0015-vite-build-tool.md) | Vite 8 as the build tool and dev server | Accepted | 2026-10-08 |
| [0016](0016-react-19-spa-compiler-strictmode.md) | React 19 SPA with React Compiler, and StrictMode around the viewer | Accepted | 2026-10-08 |
| [0017](0017-orval-api-client.md) | Orval generates the typed API client from FastAPI's OpenAPI 3.1 | Accepted | 2026-10-08 |
| [0018](0018-postgres-sqlalchemy-rls.md) | Postgres 17 with PostGIS, SQLAlchemy 2.1 on asyncpg, Alembic and row-level security per transaction | Accepted | 2026-10-08 |
| [0019](0019-soft-delete-policy.md) | Soft delete only for user-deletable clinical records, hard delete only by retention jobs | Accepted | 2026-10-08 |
| [0020](0020-authorization-rls-scopes-and-rbac.md) | Authorization: tenant row-level security, restrictive guest scopes and role permissions in code | Accepted | 2026-10-08 |
| [0021](0021-chosen-home-worklist-status-board-and-account-menu.md) | Prototype round 4: launchpad home, worklist by day with a preview on demand, status board, account menu, upload from a link and a fixed settings window | Accepted | 2026-10-08 |
| [0022](0022-sign-out-report-standards-and-pdf-preview.md) | Sign-out report built to CAP synoptic rules with ICCR datasets and TNM 8, with a PDF preview, print and share | Accepted | 2026-10-08 |
| [0023](0023-gap-review-backend-first.md) | Gap review: one case state model, cases from the LIS first, roles narrowed by folders, team control, and backend before UI | Proposed | 2026-10-10 |
| [0024](0024-workspaces-are-tenants.md) | Each workspace is a tenant, organisations group them, and platform operators manage both | Accepted | 2026-10-13 |
| [0025](0025-zitadel-bff-login.md) | Zitadel Cloud behind a FastAPI backend-for-frontend with sessions in Postgres | Accepted | 2026-10-13 |
| [0026](0026-roles-and-permission-matrix.md) | Six roles and the UX kit's permission matrix in code, declared on every route | Accepted | 2026-10-13 |
| [0027](0027-audit-log-hash-chain-in-postgres.md) | Audit log as an append-only Postgres table with a hash chain per workspace and people named by erasable pseudonyms | Accepted | 2026-10-14 |
| [0028](0028-data-classes-on-columns.md) | Five data classes declared on every column, with a generated data map | Accepted | 2026-10-14 |
| [0029](0029-service-accounts-with-own-api-tokens.md) | Service accounts per workspace with our own hashed API tokens and narrow scopes | Accepted | 2026-10-14 |
| [0030](0030-invitations-bound-to-verified-email.md) | Invitations bound to a verified email, accepted by a signed-in person, with operators inviting first administrators | Accepted | 2026-10-14 |
| [0031](0031-idle-lock-from-explicit-activity.md) | Idle lock driven by explicit activity, unlocked by signing in again, with limits set per workspace | Accepted | 2026-10-14 |
| [0032](0032-signing-rights-on-the-membership.md) | Signing rights on the membership, decided by one function, changed only by a lead | Accepted | 2026-10-14 |
| [0033](0033-envelope-encryption-with-tenant-data-keys.md) | Envelope encryption with versioned tenant data keys under a rotating master keyring | Accepted | 2026-10-14 |
| [0034](0034-blind-indexes-for-encrypted-patient-identifiers.md) | Exact-match blind indexes for encrypted patient identifiers, with name search by whole words | Accepted | 2026-10-14 |
| [0035](0035-fhir-r4-through-fhir-resources-r4b.md) | FHIR R4 on the wire through fhir.resources' R4B models, with codes checked by us and no FHIR server | Accepted | 2026-10-14 |
| [0036](0036-case-data-model.md) | Case data model: patient, case, specimen, block and slide, with the kit's ten states and FHIR's codes | Accepted | 2026-10-14 |
| [0037](0037-accession-number-templates.md) | Accession numbers from a per-workspace template with a counter per prefix and year | Accepted | 2026-10-14 |
| [0038](0038-case-state-machine.md) | Case state machine: named events with allowed actors, derived moves by the system, cancel and restore by leads | Accepted | 2026-10-14 |
| [0039](0039-email-through-resend-with-phi-rules.md) | Send email through Resend, with bounce handling and a rule that email never carries PHI | Accepted | 2026-10-14 |
| [0040](0040-observability-and-phi-scrubbing.md) | Observability with OpenTelemetry, Grafana Cloud and Sentry, and one PHI scrubbing rule set | Accepted | 2026-10-14 |
| [0041](0041-identity-and-authorization-rechecked.md) | Identity and authorization rechecked in October 2026: Zitadel Cloud and row-level security with roles in code both confirmed | Accepted | 2026-10-14 |
| [0046](0046-roles-narrowed-by-folders.md) | Folder-scoped permissions apply inside a person's folders, unfiled cases stay open, and leads may work in every folder | Accepted | 2026-10-14 |
| [0042](0042-model-licensing-policy.md) | Model licensing policy: Parfocal is commercial, and the registry blocks any model whose weights or training data licences are not confirmed | Rejected | 2026-10-14 |
| [0045](0045-forms-and-validation.md) | Forms with TanStack Form and Zod 4, and report forms driven by template data | Accepted | 2026-10-14 |
| [0044](0044-background-jobs-and-workflows.md) | Background jobs and workflows on Postgres tables with leases, confirming the default of ADR 0003 | Accepted | 2026-10-14 |
| [0047](0047-emergency-access-with-a-reason.md) | Emergency access: a written reason opens one case for a lab-set time, administrators included | Accepted | 2026-10-14 |
| [0051](0051-availability-status-and-back-up.md) | Availability status per workspace, with an away person's new cases going to their back-up | Accepted | 2026-10-15 |
| [0043](0043-server-slide-reading.md) | Server slide reading with OpenSlide first, tiffslide for OME-TIFF and tifffile for validation | Accepted | 2026-10-15 |
| [0048](0048-routing.md) | Routing with TanStack Router and Zod search params | Accepted | 2026-10-15 |
| [0049](0049-server-state-and-data-fetching.md) | Server state in TanStack Query v5 on the generated client, with event-driven invalidation | Accepted | 2026-10-15 |
| [0050](0050-deploy-pipeline-and-previews.md) | Deploy pipeline and per-pull-request previews on Cloudflare, Modal and Neon | Accepted | 2026-10-15 |
