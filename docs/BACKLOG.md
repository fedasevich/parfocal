# Parfocal backlog

This file takes an empty repository to a production-quality, multi-tenant cloud platform for pathologists. It covers whole-slide viewing, AI-assisted review and annotation, collaboration, reporting and sign-out. Tasks are split by feature and sized so that one task is one pull request of about half a day to two days. Work them top to bottom inside a milestone, respecting the dependencies.

The design source is the approved prototype pair:

- UX kit: https://claude.ai/artifact/WKq3HJJWYL15oY4nXNBweC (offline copy `/Users/yuriifedas/WebstormProjects/poc/docs/ux-kit/index.html`, [GitHub](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/ux-kit/index.html))
- Hi-fi mock: https://claude.ai/artifact/3axrsHDKG5EqDyxu3nZYoJ (offline copy `/Users/yuriifedas/WebstormProjects/poc/docs/ux-mock/index.html`, [GitHub](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/ux-mock/index.html))

The research source is the archived POC at `/Users/yuriifedas/WebstormProjects/poc` (GitHub https://github.com/fedasevich/pathlogy-poc, branch `master`). [project/poc-reference.md](project/poc-reference.md) lists every POC doc with full links and says what to do if the local copy is missing. It is reference only. Read the referenced POC files and docs before starting a task to see how an idea was captured and what went wrong, then write fresh code for this repository. Never modify the POC and never copy whole modules from it.

## How to use this file

Task format:

```
  - [ ] EPIC-NNN · Short imperative title
    Done when ... (always names the tests that prove it)
    Depends on ... Refs ...
```

- IDs are `EPIC-NNN` and never change once written. New tasks get the next free number in their epic, even if they are inserted out of order.
- Tick a box only when the task's "Done when" line is fully true and CI is green on the merged branch.
- When a task turns out to be bigger than two days, split it into new IDs under the same epic and leave a one-line note under the original.
- When a decision changes a later task, edit that task and add an ADR rather than leaving the old text in place.
- `poc/` means `/Users/yuriifedas/WebstormProjects/poc/` locally or `https://github.com/fedasevich/pathlogy-poc/blob/master/` on GitHub, and code references are links. `doc NN` means `poc/docs/NN-*.md`, listed with full links in [project/poc-reference.md](project/poc-reference.md). `kit:` names a UX kit page or wireframe (W1 to W31). `mock N` names step N of the converged mock tab (1 Home to 18 Shortcut sheet).
- Every feature epic starts with an `xxx-000` research check. It re-checks the current state of the art for that feature's libraries and patterns, confirms or revises the STACK decisions it relies on, and records the outcome as an ADR in `docs/adr/`.

### Definition of Done (applies to every task)

1. Code follows the repository conventions and passes lint, format and type checks for both TypeScript and Python.
2. Tests at the right level are added and green. That means unit tests for logic, API tests for endpoints, component tests for UI, E2E tests for user flows, golden-image tests for rendering and perf/memory budget tests for the viewer hot path (CPU-side in CI, GPU-side as manual result files, [ADR 0011](adr/0011-hosted-ci-only.md)). The "Done when" line names which ones.
3. User-facing UI passes axe accessibility checks and has keyboard paths. New strings go through the i18n layer.
4. Tenant isolation is preserved. Any new table, bucket path, cache key or queue message carries the tenant and is covered by an isolation test.
5. Any PHI access or state change that matters clinically is written to the audit log.
6. Observability is added where it helps: structured logs without PHI, traces on new endpoints and metrics on new jobs.
7. Docs are updated where behaviour changed. That means OpenAPI descriptions, the relevant ADR or runbook, and the user-facing help text.

## Decisions already made

| Topic | Decision |
| --- | --- |
| Release bar | Research and pilot grade, production-quality code, no regulatory claims in v1. IVDR, FDA and CE marking are later epics |
| Deployment | Cloud SaaS, multi-tenant. Region is a tenant attribute. No residency pinning during the pilot, and EU pinning is a trigger before the first tenant with real PHI ([ADR 0003](adr/0003-pilot-platform-architecture.md)) |
| Pilot data | Public slide datasets with seeded fake patient identities. No real PHI until the triggers in [ADR 0003](adr/0003-pilot-platform-architecture.md) are met |
| Compliance | GDPR, HIPAA and ISO 27001 readiness in v1: audit log, encryption, residency, retention and erasure, BAA-ready logging, pen test |
| Repository | Monorepo `/Users/yuriifedas/WebstormProjects/parfocal` (GitHub `fedasevich/parfocal`) with `apps/web`, `apps/api`, `workers/*`, `packages/*` |
| Frontend | React with TypeScript. Every other library is a STACK decision |
| Backend | Python. Framework and every other library are STACK decisions |
| Renderer | Viv is the primary renderer and must work perfectly. The custom WebGPU engine and deck.gl 9.4 WebGPU stay as alternates behind one renderer interface, switchable only in the developer drawer |
| Formats | Read every format the POC could read, natively, with no conversion by default. Convert only when a format is unreadable or fails its performance budget. Sidecar indexes and derived low-resolution levels are allowed because they do not change the original |
| Ingest | Resumable browser upload with server validation and indexing. DICOMweb, watch folders and LIS intake are later epics |
| Identity | OIDC through a managed or self-hosted identity provider. Organisations, roles and invitations live in our database. Per-organisation SAML or OIDC SSO is a later task |
| AI runtime | Hybrid. Batch work (pre-read, whole-slide nuclei, tumor maps, training) runs on server GPU workers. Interactive segmentation runs in the browser through ONNX, using server-computed embeddings when they exist |
| AI scope v1 | Interactive segmentation, whole-slide nuclei detection and typing, tumor and region maps, learning from corrections |
| Model licensing | Open decision (STACK-031). HoVer-NeXt and VISTA-2D weights are CC BY-NC-SA. PanNuke-derived calibration needs review. The model registry stores licence metadata from day one |
| ML evaluation | The POC harness is ported as the MLEVAL epic and gates promotion of any model to a tier |
| UX variants | All four home variants and all five worklist views ship behind feature flags, switchable by the user and by experiment |
| Devices | Mouse, keyboard, trackpad, tablet with pen, gamepad (Gamepad API), SpaceMouse (WebHID) |
| Collaboration | Realtime threads, presence, follow-my-view and expiring cross-organisation guest links. No CRDT multiplayer annotation in v1 |
| Cases and reports | Manual case creation plus CSV and FHIR import. Templated synoptic reports, the first one for sentinel lymph node. PDF export with AI disclosure. LIS integration is an adapter interface only |
| Language | English only, with every string externalised (i18n-ready) |
| Offline | No offline mode. The Fast tier runs in the browser. Edits are optimistic and retried on flaky networks |
| UX research | Feature flags, experiments, PHI-free opt-in analytics, in-app SUS and SEQ, task timing for the KPIs |
| Sequencing | Walking skeleton first (M1), then feature epics deepen it |
| Testing | Everything is tested. The TEST epic builds the infrastructure, and every task's "Done when" names its tests |

## Product KPIs carried from the UX kit

- Chrome covers under 35% of a 1440×900 screen in Review (POC today: 48.5%, 67% with the one-click tool).
- Core sign-out tasks take 30% less time than the POC viewer in a moderated test.
- SUS above 70 with 3 to 5 pathologists.
- Viewer stays at 60 fps while panning with 1.6M nuclei loaded (POC: under 5 ms GPU per frame with LOD, culling and paging, doc 31).

## Source map

| Area | Primary spec | Supporting POC material |
| --- | --- | --- |
| Every existing action and key | doc 34 | [`poc/src/app/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/app), [`poc/src/annotations/editor.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/editor.ts) |
| Screens, layout, principles | doc 35, kit IA and wireframes, mock 1 to 18 | doc 25 (UX review), doc 30 (Esc ladder) |
| Settings, devices, shortcuts | kit Interaction spec, mock 16 and 18, mock §2.13 device legend | doc 16 (mouse pass) |
| Design system | kit Design system page, doc 35 colour method | mock token block |
| Formats and readers | doc 08, doc 03, doc 06 | [`poc/src/slide/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/slide), [`poc/src/viv/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/viv) |
| Tile delivery and latency | doc 09, doc 32, doc 20 §3 | [`poc/scripts/latency-proxy.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/latency-proxy.mjs) |
| Rendering and memory | docs 04, 05, 07, 23, 24, 27, 31 | [`poc/src/webgpu/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/webgpu), [`poc/src/deck94/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/deck94), [`poc/src/gl/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/gl) |
| Annotation tools | docs 10, 11, 14, 15, 16, 30 | [`poc/src/annotations/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/annotations) |
| Interactive AI | docs 12, 13, 14, 15, 20, 26 | [`poc/src/segment/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/segment), [`poc/server/tools/export_pathosam_onnx.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/tools/export_pathosam_onnx.py) |
| Whole-slide jobs and paging | docs 19, 31 | [`poc/server/app/nuclei/wsi.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/app/nuclei/wsi.py), [`poc/src/segment/paged-result.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/paged-result.ts) |
| Typing, calibration, confidence | docs 21, 28, 29, 33 | [`poc/server/app/nuclei/calibration.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/app/nuclei/calibration.py) |
| Learning from corrections | docs 18, 22 | [`poc/src/segment/type-learner.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/type-learner.ts) |
| Evaluation | docs 13, 20 §2.8, 26 | [`poc/server/tools/score_*`](https://github.com/fedasevich/pathlogy-poc/tree/master/server/tools), `bench_*` |
| MONAI Label assessment | docs 12, 17, 20 §5 | [`poc/server/app/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/server/app) |
| Platform architecture research | [`poc/docs/presentation1`](https://github.com/fedasevich/pathlogy-poc/tree/master/docs/presentation1), [`poc/docs/presentation2`](https://github.com/fedasevich/pathlogy-poc/tree/master/docs/presentation2) | Cytomine, EXACT, Concentriq, QuPath, V7 reports |

## Milestones

| Milestone | Meaning | Gate |
| --- | --- | --- |
| M0 Stack decided | Every STACK task closed with an ADR | `docs/adr/` holds one ADR per slot |
| M1 Walking skeleton | Log in, create a case, upload one SVS, open it in Viv, draw a polygon, save, sign out a stub report, all on staging | SKEL epic done, E2E green on staging |
| M2 Viewer parity | Every POC format opens correctly in Viv with POC-level performance, plus alternates behind the interface | VIEW, TILES, INGEST done, perf and golden suites green |
| M3 Review loop | Worklist, case, navigation aids, review workspace, measurement, settings, palette | WL, CASE, NAV, REVIEW, MEAS, SET, CMD done |
| M4 AI pre-read | Slides are pre-read on arrival, findings and cells to check work, interactive AI in Annotate | AIP, AISEG, AINUC, AITUM, MLEVAL core done |
| M5 Collaboration and reports | Threads, presence, guest second opinion, compare, reports with PDF and sign-out | COLLAB, CMP, REPORT, CASES done |
| M6 Pilot ready | Compliance controls, ops, experiments, devices, learning loop, pilot runbook | SEC, OPS, EXP, DEV, AILEARN, PILOT done |

## Epic index

| # | ID | Epic | Milestone |
| --- | --- | --- | --- |
| 00 | STACK | Stack decisions with SOTA candidates | M0 |
| 01 | FOUND | Repository and engineering foundations | M0 to M1 |
| 02 | SKEL | Walking skeleton | M1 |
| 03 | IAM | Identity, tenancy, roles, guest access | M1 to M5 |
| 04 | SEC | Security and compliance | M1 to M6 |
| 05 | INGEST | Slide upload, validation, indexing | M1 to M2 |
| 06 | TILES | Tile delivery | M1 to M2 |
| 07 | VIEW | Viewer core, Viv primary, alternates | M1 to M2 |
| 08 | DS | Design system | M1 to M3 |
| 09 | SHELL | Application shell and layout | M1 to M3 |
| 10 | HOME | Home variants | M3 |
| 11 | WL | Worklist variants and AI queue | M3 |
| 12 | CASE | Case view | M3 |
| 13 | NAV | Navigation aids | M3 |
| 14 | REVIEW | Review workspace | M3 to M4 |
| 15 | ANN | Annotate workspace | M2 to M4 |
| 16 | MEAS | Measurements | M3 |
| 17 | COLLAB | Comments, realtime, second opinion | M5 |
| 18 | CMP | Compare slides | M5 |
| 19 | REPORT | Reports and sign-out | M5 |
| 20 | CASES | Patients, cases, import, LIS adapter | M3 to M5 |
| 21 | AIP | AI platform, registry, jobs, GPU pool | M4 |
| 22 | AISEG | Interactive segmentation | M4 |
| 23 | AINUC | Whole-slide nuclei, typing, confidence | M4 |
| 24 | AITUM | Tumor and region maps | M4 |
| 25 | AILEARN | Learning from corrections | M6 |
| 26 | MLEVAL | Evaluation harness and promotion gate | M4 |
| 27 | SET | Settings | M3 |
| 28 | CMD | Command palette and shortcuts | M3 |
| 29 | DEV | Input devices and tablet layout | M6 |
| 30 | NOTIF | Notifications | M5 |
| 31 | LAB | Developer drawer and HUD | M2 |
| 32 | EXP | Experiments, analytics, surveys | M3 to M6 |
| 33 | I18N | Internationalisation readiness | M1 |
| 34 | OPS | Infrastructure and operations | M1 to M6 |
| 35 | TEST | Test infrastructure | M0 to M6 |
| 36 | PILOT | Documentation and pilot readiness | M6 |

---

## 00 STACK · Stack decisions with SOTA candidates

Each task compares the listed candidates against the stated criteria, re-checks that they are still current (versions, maintenance, licence, security record), and ends with an ADR in `docs/adr/`. The default is the recommendation at the time of writing (October 2026). Keep it unless the check finds a reason not to. Where a spike is named, build the smallest throwaway prototype that answers the question and record its numbers in the ADR.

Cross-cutting criteria for every slot: maturity and maintenance, typed APIs, testability, licence compatible with commercial SaaS, EU hosting options, HIPAA BAA availability for managed services, and fit with the other choices.

### Frontend

- [ ] STACK-001 · Build tool and dev server
  Candidates: Vite (Rolldown-based), Rsbuild, Next.js in SPA mode. Default: Vite, because the viewer is a client-heavy SPA with workers and WASM, and the POC already runs on Vite 8.
  Done when an ADR records the choice, worker and WASM bundling are confirmed with a spike that loads an ONNX model and a module worker under COOP and COEP.
  Refs doc 14 (COOP/COEP), [`poc/vite.config.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/vite.config.ts).

- [ ] STACK-002 · React version and rendering mode
  Candidates: React 19 SPA with client rendering, React 19 with a server framework (Next.js, React Router framework mode). Default: React 19 SPA, with React Compiler evaluated. Server rendering brings little because every screen is authenticated and canvas-heavy.
  Done when the ADR records the React version, whether React Compiler is on, and the StrictMode policy for the viewer canvas.

- [ ] STACK-003 · Routing
  Candidates: TanStack Router, React Router 7 (library mode). Default: TanStack Router for fully typed routes and search params. That matters because worklist filters, case view state and deep links to a view all live in the URL.
  Done when a spike shows typed search params for `/case/:caseId/slide/:slideId?x=&y=&z=` with validation and a code-split route.

- [ ] STACK-004 · Server state and data fetching
  Candidates: TanStack Query v5, RTK Query, SWR. Default: TanStack Query, with the generated API client (STACK-008) supplying query functions and keys.
  Done when the ADR covers caching, invalidation from realtime events (STACK-024), optimistic updates with retry for annotation edits, and suspense usage.

- [ ] STACK-005 · Client UI state
  Candidates: Zustand, Jotai, Redux Toolkit, XState for the complex state machines. Default: Zustand for app UI state (panels, tools, workspace, selection), and XState only where a real state machine helps (smart minimap, review loop, one-click prompt flow).
  Done when the ADR defines which state lives where: server state in Query, UI state in Zustand, URL state in the router, and viewer hot state outside React (STACK-006).

- [ ] STACK-006 · Viewer hot-path state outside React
  Candidates: a plain observable store read with `useSyncExternalStore`, signals (Preact signals or TC39 signals polyfill), Zustand vanilla stores. Default: a framework-free viewer engine package that owns camera, tiles, overlays and workers, exposing a small subscribe API consumed through `useSyncExternalStore`. React must never re-render on camera frames.
  Done when a spike pans a Viv slide at 60 fps while a React inspector shows the zoom level, with zero React renders per frame, measured with the React profiler.
  Refs doc 24 (main-thread costs), doc 30 (code layout).

- [ ] STACK-007 · Component primitives and styling
  Candidates: React Aria Components, Radix Primitives, Ark UI. Styling: CSS Modules plus CSS custom properties, Tailwind CSS v4 with tokens, vanilla-extract, Panda CSS. Default: React Aria Components for accessible behaviour, and CSS Modules over design tokens as CSS variables. That keeps the kit's token set (dark and light) authoritative.
  Done when the ADR lists the primitive set mapped to kit components (button, segmented control, toggle, popover, dialog, menu, tabs, slider, listbox, tooltip) and confirms axe-clean output.

- [ ] STACK-008 · API contract and client generation
  Candidates: OpenAPI 3.1 from the backend with Hey API (openapi-ts) or Orval to generate a typed client and Query hooks, tRPC (ruled out by the Python backend), GraphQL. Default: OpenAPI 3.1 generated by the backend, Hey API client with TanStack Query plugin, and a CI check that fails if the generated client is stale.
  Done when the spike generates a client for two endpoints and a contract test compares the served schema with the committed one.

- [ ] STACK-009 · Forms and validation
  Candidates: React Hook Form with Zod, TanStack Form with Zod or Valibot. Default: TanStack Form with Zod, with schemas generated from OpenAPI where possible.
  Done when the ADR covers report forms with conditional fields, which are the hardest case.

- [ ] STACK-010 · Tables, lists and virtualisation
  Candidates: TanStack Table plus TanStack Virtual, AG Grid. Default: TanStack Table and Virtual for worklist, layers and audit views.
  Done when a spike renders 10,000 worklist rows with keyboard J/K navigation at 60 fps.

- [ ] STACK-011 · Charts for dashboards and confidence visuals
  Candidates: visx, Recharts, Observable Plot, ECharts. Default: visx for the custom verdict range bars and sparklines, Observable Plot for dashboard charts.
  Done when the ADR covers theming through tokens and accessibility of charts.

- [ ] STACK-012 · Frontend testing stack
  Candidates: Vitest with React Testing Library, Playwright (E2E and component tests), Storybook 9 with interaction and visual tests, MSW for API mocks, Chromatic or Playwright snapshots for visual regression. Default: Vitest, RTL, MSW, Playwright for E2E and visual, Storybook as the component catalogue.
  Done when the ADR covers how WebGPU and WebGL tests run in CI (SwiftShader software rendering on hosted runners, [ADR 0011](adr/0011-hosted-ci-only.md)) with a spike that renders one Viv tile in CI and compares it to a golden image.

- [x] STACK-013 · Package manager, monorepo orchestration, lint and format
  Candidates: pnpm workspaces with Turborepo, Nx, Moon. Lint and format: Biome, ESLint flat config with typescript-eslint plus Prettier, Oxlint. Default: pnpm and Turborepo, Biome for format and lint plus typescript-eslint for type-aware rules that Biome lacks. Decided in [ADR 0006](adr/0006-monorepo-tooling.md): TypeScript 7 with type-aware Oxlint instead of typescript-eslint, which does not support TypeScript 7.
  Done when the ADR records cache strategy for CI and how Python tasks join the same task graph.

- [ ] STACK-014 · Command palette, drag and drop, hotkeys
  Candidates: cmdk, kbar, a custom React Aria combobox. Drag and drop: dnd-kit, Pragmatic drag and drop. Hotkeys: tinykeys, react-hotkeys-hook, a custom registry. Default: cmdk, Pragmatic drag and drop, and a custom key registry. The registry has to support presets, rebinding, chords like G then n, and hold versus tap on Z, which the libraries do not cover well.
  Done when the ADR records the choices and a spike shows a G then 2 chord and a Z hold-versus-tap working with focus in and out of text inputs.
  Refs mock 15, mock 18, kit Interaction spec.

### Viewer and rendering

- [ ] STACK-015 · Viv and deck.gl versions and the WebGL2 versus WebGPU question
  Viv is primary and its layers are GLSL, so Viv runs on WebGL2. Decide the Viv and deck.gl versions, whether deck.gl 9.4 WebGPU runs as the alternate route, and how the luma.gl leak and debug-string fixes from doc 24 are applied (patch-package, upstream PR, or wrapper).
  Done when a spike opens CMU-1.svs in Viv on the chosen versions and passes the 20-slide-switch memory test (heap returns to baseline, one Deck alive).
  Refs docs 23, 24, [`poc/src/gl/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/gl), [`poc/src/viv/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/viv).

- [ ] STACK-016 · TIFF and Zarr readers in the browser
  Candidates: geotiff.js, zarrita, a WASM build of libtiff or tifffile-like readers. Default: geotiff.js and zarrita as in the POC, wrapped behind our PixelSource interface, with the known geotiff bugs worked around (YCbCr, lazy directories, big-endian BigTIFF offsets).
  Done when the ADR lists every workaround with a test fixture for each.
  Refs docs 03, 06, 08, 32.

- [ ] STACK-017 · Browser ML runtime
  Candidates: onnxruntime-web (WebGPU and WASM EPs), Transformers.js, WebNN where available. Default: onnxruntime-web with 4-bit MatMulNBits graphs for WebGPU and uint8 for WASM.
  Done when the spike reproduces the POC numbers (encode about 1.5 s, decode about 41 ms per click on WebGPU) on the chosen version.
  Refs doc 14, [`poc/src/segment/onnx*.ts`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/segment).

### Backend

- [x] STACK-018 · Python version, packaging and tooling
  Candidates: Python 3.13 or 3.14, uv for environments and lockfiles, Ruff for lint and format, pyright or basedpyright or ty for types, pytest. Default: Python 3.13 (wheel availability for the ML stack decides), uv, Ruff, basedpyright in strict mode for the API and standard for ML code, pytest with pytest-asyncio. Decided in [ADR 0007](adr/0007-python-tooling.md): Python 3.14, because the whole stack now has 3.14 wheels.
  Done when the ADR confirms the scientific stack (torch, openslide, tifffile, zarr) has wheels for the chosen version on Linux x86_64 and aarch64.
  Refs doc 12 (MONAI Label had no 3.14 wheels).

- [ ] STACK-019 · Web framework
  Candidates: FastAPI with Pydantic v2, Litestar, Django with Django Ninja. Default: FastAPI with Pydantic v2 for OpenAPI 3.1 generation, async I/O and the ecosystem.
  [ADR 0003](adr/0003-pilot-platform-architecture.md) runs FastAPI on Modal as an ASGI app. The API package must not import Modal, so it can move to another container host.
  Done when a spike serves an authenticated, tenant-scoped endpoint with generated OpenAPI that STACK-008 consumes, and records Modal cold-start time and API latency budgets.

- [ ] STACK-020 · Database, ORM and migrations
  Candidates: PostgreSQL 17 with PostGIS. ORM: SQLAlchemy 2.0 async with Alembic, SQLModel, Piccolo. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): PostgreSQL 17 plus PostGIS on Neon, SQLAlchemy 2.0 async, Alembic, asyncpg, Neon's built-in PgBouncer pooler in transaction mode with tenant context set by `SET LOCAL` inside each transaction. Docker `postgis/postgis:17` locally and a Neon branch per preview.
  Done when the ADR covers row-level security for tenancy (STACK-023), bulk inserts for AI output through COPY, autovacuum tuning for annotation tables, asyncpg behaviour behind the pooler, and picks the Neon region with the lowest measured latency from Modal's API containers.
  Refs Cytomine and EXACT reports in [`poc/docs/presentation2`](https://github.com/fedasevich/pathlogy-poc/tree/master/docs/presentation2) (PostGIS bloat, bulk insert costs).

- [ ] STACK-021 · Annotation and AI result storage model
  Options: PostGIS rows for human annotations plus columnar chunk files in object storage for model output (the POC split), everything in PostGIS, GeoParquet or FlatGeobuf files per job. Default: the split. Human annotations go in PostGIS with an append-only version table. Model output is stored as typed-array chunks per job tile in object storage with a summary index, and FlatGeobuf is used for export.
  Done when the ADR defines the chunk schema (including type probabilities, which the POC paged format dropped) and a spike pages 1.6M nuclei in the browser under the doc 31 budgets.
  Refs docs 11, 19, 31, 33.

- [ ] STACK-022 · Background jobs and durable workflows
  Candidates: Temporal, Hatchet, Celery, Dramatiq, arq. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): job, step and tile tables in Postgres, steps run as Modal functions started with `spawn`, and a Modal cron function that resumes orphaned steps from the last completed tile. Temporal and Hatchet were set aside because they need always-on workers.
  Done when a spike runs a three-step workflow that survives a worker restart mid-step and resumes from the last completed tile.
  Refs doc 20 §5 (jobs must survive restart).

- [ ] STACK-023 · Authorization model
  Candidates: application RBAC with PostgreSQL row-level security, OpenFGA or SpiceDB for relationship-based sharing, Cerbos or OPA for policies. Default: RLS for hard tenant isolation, an RBAC permission table for roles, and OpenFGA only if guest links and cross-organisation sharing outgrow plain tables.
  Done when the ADR shows how a guest from organisation B reads one view of one case in organisation A without any other access, with the test plan for it.

- [ ] STACK-024 · Realtime transport
  Candidates: FastAPI WebSockets with Valkey pub/sub, Centrifugo, Server-Sent Events plus POST, a managed service (Ably, Pusher, Liveblocks). Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare Durable Objects with WebSocket Hibernation, one room per case and one per user. Durable Objects carry ephemeral events only and Postgres stays the system of record. FastAPI posts events to a room over an authenticated internal route, and clients refetch on reconnect.
  Done when the spike shows presence and a thread update reaching two browsers under 300 ms on staging.

- [ ] STACK-025 · Object storage, CDN and signed access
  Candidates: S3, Google Cloud Storage, Azure Blob, Cloudflare R2, with CloudFront, Cloud CDN or Cloudflare in front. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare R2 with one bucket per environment, keys under `t/{tenant}/s/{slide}/`, and a Worker gateway under the app origin that verifies capability tokens and serves byte ranges through the R2 binding. Presigned URLs are for uploads only, because presigned GETs work only on the S3 API domain and bypass the CDN. Requirements are HTTP/2 or HTTP/3 at the edge, Range requests, signed URLs or signed cookies scoped to a tenant and slide, COOP and COEP header injection, and no SPA fallback on data paths.
  Done when a spike measures cold and warm tile fetch latency through the Worker gateway, with and without a Cache API layer keyed per byte range, for SVS byte ranges and OME-Zarr chunks.
  Refs docs 09, 20 §3.2, 32.

- [ ] STACK-026 · Slide reading and tiling on the server
  Candidates: OpenSlide 4 with openslide-python, tiffslide, tifffile, TIAToolbox, bioformats2raw for conversion fallbacks, MONAI Label as middleware. Default: tifffile and tiffslide (plus OpenSlide where it reads better) for validation, indexing, thumbnails and patches, TIAToolbox for pixel-size-aware tiling in ML workers, no MONAI Label server. Doc 20 found that only its endpoint shape and datastore were still in use.
  Done when the ADR lists, per POC format, which server library reads it and which fixture proves it.
  Refs docs 08, 12, 17, 20 §5.

- [ ] STACK-027 · GPU inference serving
  Candidates: plain PyTorch workers pulling from the workflow engine, NVIDIA Triton, Ray Serve, BentoML. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): PyTorch in Modal GPU functions per model family. Batch work starts cold. Interactive embeddings run in a separate function that the API pre-warms when a slow device activates the segmentation tool, and it scales down after about 5 idle minutes. Separate containers replace the priority gate. Triton is reconsidered when the model count grows.
  Done when a spike shows an interactive embedding request served within 1 s from a pre-warmed container while a whole-slide job runs, and records the cold-start time.
  Refs doc 19 (GPU gate), doc 26 (job ops).

- [ ] STACK-028 · Identity provider
  Candidates: Keycloak (self-hosted), Zitadel, WorkOS, Auth0, Clerk. Criteria: OIDC with PKCE, MFA, organisation SSO later, EU hosting, HIPAA BAA, cost per user. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Zitadel Cloud on the free plan. FastAPI is a confidential OIDC client in the BFF pattern. The browser holds only an HttpOnly, Secure, SameSite=Strict session cookie, and sessions and refresh tokens live in Postgres.
  Done when the ADR records the choice and a spike logs in through the BFF, refreshes tokens server-side without the SPA noticing and maps IdP organisations to tenants.

### Platform and operations

- [ ] STACK-029 · Cloud provider, regions and GPU availability
  Candidates: AWS, Google Cloud, Azure, plus an EU sovereign option. Criteria: EU region with GPU instances (L4, L40S, A100 or H100), HIPAA BAA, ISO 27001 certified regions, managed Postgres with PostGIS, managed Kubernetes. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): no single cloud. Cloudflare (Workers, Durable Objects, R2, Pages), Modal (Python and GPUs) and Neon (Postgres), with no region pinning during the pilot.
  Done when the ADR includes a monthly cost estimate for the pilot (three tenants, 5,000 slides per month).

- [ ] STACK-030 · Infrastructure as code, deploy and runtime platform
  Candidates: OpenTofu or Terraform, Pulumi. Kubernetes with Helm and Argo CD, or a simpler container platform (Cloud Run, ECS). Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): no Kubernetes. Wrangler config for the edge, Modal app code for Python, the Neon API for branches, GitHub Actions for deploys, and a small OpenTofu module for DNS, buckets and the Zitadel and Neon projects.
  Done when the ADR covers preview environments per pull request for the web app and API.

- [ ] STACK-031 · Model licensing policy (open decision)
  Decide whether the product is commercial, then which models may run in which tenant type. HoVer-NeXt and VISTA-2D weights are CC BY-NC-SA 4.0. Verify PathoSAM, SlimSAM, NuClick, SAM2, the MONAI bundles and any foundation models (UNI2, Virchow2, H-optimus, Prov-GigaPath) from their hosted weight licences, not from repository licences. Review the training and calibration datasets (PanNuke, CoNSeP, CAMELYON16) the same way.
  Done when the ADR has a licence matrix (model, weights licence, data licence, allowed tenant types) and the model registry (AIP-002) enforces it.
  Refs docs 17, 29, [`poc/docs/presentation2/SlideViewersOneClick.html`](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/presentation2/SlideViewersOneClick.html).

- [ ] STACK-032 · Observability
  Candidates: OpenTelemetry SDKs everywhere, then Grafana stack (Loki, Tempo, Mimir or Prometheus), Datadog, or Honeycomb. Error tracking with Sentry (self-hosted or EU). Frontend real-user monitoring for viewer frame times. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): OpenTelemetry to the Grafana Cloud free tier, Sentry SaaS free plan, Workers Logs and Modal logs, exporting only from production with console output in every other environment ([ADR 0005](adr/0005-external-sends-only-in-production.md)), and a PHI scrubber in every pipeline.
  Done when the ADR defines the PHI scrubbing rules and a test proves a patient name in a log line is redacted.

- [ ] STACK-033 · Feature flags, experiments and product analytics
  Candidates: GrowthBook, PostHog (self-hosted EU), Unleash, Statsig. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): PostHog Cloud for flags, experiments, analytics and surveys, with autocapture and session replay off. Only production sends events and evaluates flags in PostHog, and other environments read flag defaults from a local file ([ADR 0005](adr/0005-external-sends-only-in-production.md)). No PHI ever leaves the platform in events.
  Done when a spike assigns users to the home variants A to D and records an exposure event without identifiers beyond a pseudonymous user id.

- [ ] STACK-034 · Search
  Candidates: PostgreSQL full-text search with pg_trgm, Meilisearch, OpenSearch. Default: PostgreSQL FTS and trigram, because patients, cases and reports are tenant-scoped and small per tenant, and RLS then covers search too.
  Done when the spike returns patient, case and report results for a partial name in under 100 ms on 100,000 seeded cases.

- [ ] STACK-035 · PDF generation for reports
  Candidates: Typst, WeasyPrint, headless Chromium (Playwright) print, ReportLab. Default: Typst for deterministic, versionable templates, or WeasyPrint if templates must share HTML and CSS with the web preview.
  Done when the spike renders the sentinel node report with a signature block and AI disclosure in both preview and PDF with matching content.

- [ ] STACK-036 · Email and transactional notifications
  Candidates: Amazon SES, Postmark, Resend, SendGrid, with EU data processing and BAA where needed. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Resend through its HTTP API in production only. Other environments use a console sender and automated tests an in-memory fake ([ADR 0005](adr/0005-external-sends-only-in-production.md)). Templates are rendered server-side and no PHI goes in subject lines.
  Done when the ADR covers bounce handling and the PHI rules.

- [ ] STACK-037 · Secrets and key management
  Candidates: cloud KMS with envelope encryption, HashiCorp Vault or OpenBao, External Secrets Operator for Kubernetes. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): application-level envelope encryption. Per-tenant data keys are wrapped by a master key held as a Modal secret, and sensitive columns are AES-GCM encrypted in FastAPI. Moving the master key to a KMS is a trigger before real PHI. Runtime secrets live in Modal secrets, Wrangler secrets and GitHub environments.
  Done when the ADR defines key rotation and how a tenant's data becomes unreadable after crypto-shredding on erasure.

- [x] STACK-038 · CI provider and runners
  Candidates: GitHub Actions with hosted runners plus a self-hosted GPU runner, GitLab CI, Buildkite. Default: GitHub Actions, plus one GPU runner for golden-image, WebGPU and perf suites.
  Done when the ADR lists which suites run on every pull request, nightly and before release.
  Decided in [ADR 0011](adr/0011-hosted-ci-only.md), which supersedes ADR 0010: GitHub Actions on hosted runners only, no self-hosted runners and no GPU-heavy suites.

- [ ] STACK-039 · Resumable upload protocol
  Candidates: tus (tusd or tus-py), S3 multipart with presigned parts (Uppy), Google resumable uploads. Default: S3-style multipart with presigned parts via Uppy on the client against R2's S3 API ([ADR 0003](adr/0003-pilot-platform-architecture.md)), with bucket CORS allowing the app origin. This avoids routing multi-gigabyte slides through the API.
  Done when a spike uploads a 4 GB NDPI over a throttled connection with a forced disconnect and resumes without restarting.

- [ ] STACK-040 · FHIR and HL7 libraries
  Candidates: fhir.resources (Pydantic), HAPI FHIR as an external server, python-hl7 for v2. Default: fhir.resources for parsing and building Patient, ServiceRequest, Specimen and DiagnosticReport, and no FHIR server in v1.
  Done when the ADR fixes the FHIR version (R4 or R5) and the resources in scope.

---

## 01 FOUND · Repository and engineering foundations

- [ ] FOUND-000 · Research check for monorepo, CI and developer experience
  Re-check STACK-013, STACK-018 and STACK-038 against current releases and record anything that changed.
  Done when an ADR exists or the existing ADRs are confirmed.

- [x] FOUND-001 · Monorepo skeleton
  Create `apps/web`, `apps/api`, `apps/edge` (router Worker and Durable Objects), `workers/ingest`, `workers/ml`, `packages/viewer-engine`, `packages/ui`, `packages/api-client`, `packages/tokens`, `packages/test-fixtures`, `infra/`, `docs/adr/`. Root README explains the layout.
  Done when `pnpm install` and `uv sync` succeed from a clean clone and a smoke test in each package passes.
  Depends on STACK-013, STACK-018.

- [x] FOUND-002 · Project agent guide and docs memory system
  Write `AGENTS.md` (imported by `CLAUDE.md`) with the backlog workflow (read the task, read the POC refs, write the tests, tick the box), the docs memory system (log, ADRs, results, knowledge, consolidation), the writing rules, the "never touch the POC" rule and the Definition of Done. See ADR 0001.
  Done when the files are committed and linked from the README.

- [x] FOUND-003 · ADR template and index
  Done when `docs/adr/0000-template.md` and an index exist and a CI check fails if an ADR is missing its status field.

- [x] FOUND-004 · TypeScript configuration
  Strict mode, shared source across packages instead of project references ([ADR 0008](adr/0008-typescript-internal-packages.md)), path aliases, separate configs for workers.
  Done when `pnpm typecheck` covers every package and a deliberately broken import fails CI.

- [x] FOUND-005 · Python project layout and tooling
  `apps/api` and `workers/*` as uv workspace members with shared `packages/py-common` for settings, logging, tenancy context and audit helpers.
  Done when Ruff, the type checker and pytest run from the root and in CI.

- [x] FOUND-006 · Lint, format and pre-commit hooks
  Done when a pre-commit or lefthook config runs Biome, type-aware Oxlint, Ruff and secret scanning on staged files, and CI runs the same checks.

- [ ] FOUND-007 · CI pipeline for pull requests
  Jobs for install with cache, lint, typecheck, unit tests for TS and Python, API contract check, build of web and API images. Turborepo remote cache if allowed.
  Done when a pull request shows all jobs and a failing unit test blocks merge.
  Depends on STACK-038.

- [ ] FOUND-008 · OpenAPI generation and client codegen pipeline
  The API emits OpenAPI 3.1, `packages/api-client` is generated from it, and CI fails when the committed client is stale.
  Done when a contract test proves the served schema equals the committed one.
  Depends on STACK-008, STACK-019.

- [ ] FOUND-009 · Local development environment
  Docker Compose with Postgres plus PostGIS only. The Vite dev server runs the edge Worker and Durable Objects through the Cloudflare Vite plugin with a remote binding to the `parfocal-dev` R2 bucket, FastAPI runs under uvicorn and jobs run in-process behind the same runner interface as Modal. Zitadel Cloud and the dev bucket are real cloud resources configured through `.env` ([ADR 0004](adr/0004-cloud-dev-resources.md)). One command starts everything. Seeded dev tenant. See [knowledge/local-dev.md](knowledge/local-dev.md).
  Done when a new machine runs `make dev` (or equivalent) and reaches the logged-in home screen in under 10 minutes, documented in the README.

- [ ] FOUND-010 · Configuration and settings management
  Typed settings in Python (pydantic-settings) and a typed runtime config for the web app. No secrets in the frontend bundle. One `APP_ENV` setting (`dev`, `test`, `preview`, `staging`, `prod`) picks the email, error reporting, telemetry export, analytics and flag clients at startup, and only `prod` talks to Resend, Sentry, Grafana Cloud and PostHog ([ADR 0005](adr/0005-external-sends-only-in-production.md)).
  Done when a test fails startup on a missing required setting, the web build fails if a non-public variable is referenced, and a test shows that with any `APP_ENV` other than `prod` no client for those services is created.

- [ ] FOUND-011 · Structured logging with tenant and request context
  JSON logs, request id, tenant id, user id as pseudonymous ids, PHI scrubber.
  Done when a test shows a patient name passed to a logger is redacted.
  Depends on STACK-032.

- [ ] FOUND-012 · Error handling conventions
  RFC 9457 problem details in the API, a typed error mapping in the client, and user-facing error toasts without stack traces.
  Done when contract tests cover 400, 401, 403, 404, 409 and 422 shapes.

- [ ] FOUND-013 · Database baseline and migrations
  Alembic set up, naming conventions, `tenant_id` on every tenant-owned table, created and updated timestamps, soft-delete policy decided.
  Done when a migration test upgrades and downgrades an empty database in CI.
  Depends on STACK-020.

- [ ] FOUND-014 · Dependency and licence scanning
  Renovate or Dependabot, `pip-audit`, `pnpm audit`, licence allowlist for npm and PyPI.
  Done when a disallowed licence in a test dependency fails CI.

- [ ] FOUND-015 · Container images
  Modal image definitions for the API, ingest and ML (CUDA base) functions with pinned versions, plus a multi-stage Dockerfile for the API so it can run on another host ([ADR 0003](adr/0003-pilot-platform-architecture.md)). The web app is static assets on Cloudflare. Non-root, pinned digests, SBOM output.
  Done when the API image and the Modal images build in CI and a container scan of the API image reports no critical vulnerabilities.

- [ ] FOUND-016 · Shared test fixtures package
  `packages/test-fixtures` documents how to fetch large fixtures (CMU-1 family, CAMELYON16 tumor_009 and test_001, OpenSlide corpus) into a cache, plus tiny synthetic slides committed in the repo.
  Done when `pnpm fixtures` downloads with checksums and CI caches them.
  Refs [`poc/scripts/fetch-formats.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/fetch-formats.mjs), [`poc/scripts/fetch-camelyon.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/fetch-camelyon.mjs).

- [ ] FOUND-017 · Release versioning and changelog
  Done when conventional commits are enforced and a changelog is generated per release tag.

---

## 02 SKEL · Walking skeleton (milestone M1)

The thinnest end-to-end slice. Every piece is minimal and later epics deepen it. The point is to prove the stack, the deployment and the test pipeline together before breadth.

- [ ] SKEL-001 · Staging environment exists
  Minimal infrastructure from OPS-001 to OPS-004 with one tenant.
  Done when `https://staging.<domain>` serves the web app and `/api/health` over TLS with COOP and COEP headers.
  Depends on OPS-001, OPS-002.

- [ ] SKEL-002 · Log in through the IdP
  Done when a Playwright test logs in a seeded pathologist on staging and sees their name in the top bar.
  Depends on IAM-001, IAM-002.

- [ ] SKEL-003 · Minimal tenant, user and case tables
  Done when API tests create a case for the user's tenant and another tenant's user gets 404 for it.
  Depends on IAM-003, CASES-001.

- [ ] SKEL-004 · Upload one SVS into a case
  Presigned multipart upload, object lands under the tenant's prefix, a slide row is created.
  Done when an E2E test uploads CMU-1-Small-Region.svs and the slide shows in the case.
  Depends on INGEST-001, INGEST-002.

- [ ] SKEL-005 · Validate and index the slide
  The ingest workflow reads the pyramid, writes level metadata and a thumbnail.
  Done when the workflow test asserts level sizes, microns per pixel and the thumbnail checksum for the fixture.
  Depends on INGEST-004, INGEST-010.

- [ ] SKEL-006 · Open the slide in Viv
  Signed tile access, one Viv layer, wheel zoom and drag pan.
  Done when a golden-image test of the fitted view matches within tolerance in CI with software rendering.
  Depends on VIEW-002, TILES-001.

- [ ] SKEL-007 · Draw and save one polygon
  Polygon tool only, stored in PostGIS through the API.
  Done when an E2E test draws, reloads and sees the same polygon.
  Depends on ANN-001, ANN-020.

- [ ] SKEL-008 · Stub report and sign out
  One free-text field, sign-out records signer and time, the case moves to signed.
  Done when an E2E test signs out and the case shows as signed in a list, with an audit log entry.
  Depends on REPORT-001, SEC-003.

- [ ] SKEL-009 · CI deploys main to staging
  Done when merging to main deploys automatically and the skeleton E2E suite runs against staging after deploy.
  Depends on OPS-005.

- [ ] SKEL-010 · Skeleton retrospective
  Done when an ADR lists what the skeleton revealed (latency, memory, gaps) and the backlog is edited to reflect it.

---

## 03 IAM · Identity, tenancy, roles, guest access

- [ ] IAM-000 · Research check for identity and authorization
  Done when STACK-023 and STACK-028 are confirmed or revised in an ADR.

- [ ] IAM-001 · IdP deployment and configuration
  Organisation setup in Zitadel Cloud, a confidential client for the API's BFF login ([ADR 0003](adr/0003-pilot-platform-architecture.md)), MFA policy (TOTP and WebAuthn).
  Done when the IdP config is code (exported realm or Terraform provider) and recreated from scratch in CI.
  Depends on STACK-028.

- [ ] IAM-002 · Login, logout and session refresh through the BFF
  FastAPI runs the OIDC code flow and refreshes tokens server-side. The SPA only sees a session cookie ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when Playwright covers login, refresh after expiry, logout and redirect back to the deep link the user started from.

- [ ] IAM-003 · Tenants and organisations
  Tenant table, slug, region, plan, status. An organisation can hold several workspaces (diagnostic, research de-identified, second-opinion network).
  Done when API tests create, suspend and reactivate a tenant and a suspended tenant's users are refused.
  Refs kit IA "Other workspaces", mock 1 org switcher.

- [ ] IAM-004 · Tenant context and row-level security
  Every request sets the tenant in the database session. RLS policies on every tenant-owned table.
  Done when an isolation test suite runs every list and get endpoint as a user of tenant B against data of tenant A and gets nothing. The suite runs automatically on every new table.
  Depends on FOUND-013.

- [ ] IAM-005 · Users, memberships and profiles
  User row linked to the IdP subject, membership per tenant and workspace, display name, initials, avatar colour, title (MUDr.).
  Done when API tests cover membership in two tenants and switching between them.

- [ ] IAM-006 · Roles and permissions
  Roles: org admin, lab admin, lab lead, consultant pathologist, resident, annotator, guest consultant, secretary, read-only clinician. A permission matrix in code and a generated doc page.
  Done when a table-driven test asserts every endpoint's permission for every role.

- [ ] IAM-007 · Invitations
  Admins invite by email with a role, invites expire, acceptance creates the membership.
  Done when E2E covers invite, accept and expiry, and the audit log records each step.

- [ ] IAM-008 · Workspace switcher
  The top-left organisation and workspace switcher from mock 1 and kit W1.
  Done when a component test and an E2E test switch workspace and the worklist reloads in the new scope.

- [ ] IAM-009 · Session policies
  Idle lock after the lab-set time (default 15 min) that returns to the same view on unlock, "sign out on other devices", concurrent session list.
  Done when tests cover lock, unlock to the same camera position, and remote session revocation.
  Refs mock §2.15 Privacy and session.

- [ ] IAM-010 · Guest consultant links
  Expiring, revocable links scoped to one case, optionally one view and its threads, for a user from another organisation. The guest signs in with their own IdP account or a verified email.
  Done when tests prove the guest can read only that case and post only in the shared threads, the link expires, and revocation takes effect within one minute.
  Depends on STACK-023. Refs kit Flow 3, mock 10.

- [ ] IAM-011 · Service accounts and API tokens
  For integrations (LIS adapter, import scripts), with scopes and rotation.
  Done when tests cover scope enforcement and token revocation.

- [ ] IAM-012 · Per-organisation SSO
  SAML or OIDC federation per tenant through the IdP, with just-in-time provisioning and role mapping.
  Done when an E2E test logs in through a test SAML IdP.

- [ ] IAM-013 · SCIM provisioning
  Done when a SCIM test client creates, updates and deactivates users.
  Depends on IAM-012.

- [ ] IAM-014 · Admin console for users and roles
  Lab admin screen to list members, change roles, deactivate and resend invites.
  Done when component and E2E tests cover each action and each action is audited.

---

## 04 SEC · Security and compliance (GDPR, HIPAA, ISO 27001 readiness)

- [ ] SEC-000 · Research check for compliance controls
  Map GDPR articles, the HIPAA Security Rule safeguards and ISO 27001:2022 Annex A controls to the backlog.
  Done when a control matrix in `docs/compliance/controls.md` links each control to a task ID or marks it as policy work.

- [ ] SEC-001 · Data classification and PHI inventory
  Classify every field (PHI, personal, operational, public). Generate a data map from model annotations in code.
  Done when a CI check fails if a new column lacks a classification.

- [ ] SEC-002 · Encryption in transit and at rest
  TLS 1.2+ everywhere including internal traffic, encrypted volumes, buckets and backups, HSTS.
  Done when an automated config test (for example tfsec or checkov rules) passes and a TLS scan scores A.

- [ ] SEC-003 · Audit log
  Append-only audit table with hash chaining. Every PHI read (case open, slide open, report view), every write that matters clinically (annotation accept, review decision, sign-out, amendment), every permission change. Export for auditors.
  Done when tests prove entries cannot be updated or deleted by the app role, the chain verifies, and an auditor export lists a case's full history.
  Refs Concentriq report (21 CFR Part 11, ALCOA+).

- [ ] SEC-004 · Field-level encryption for direct identifiers
  Patient name, MRN and birth date encrypted with tenant data keys. Search uses blind indexes or trigram on a tokenised form.
  Done when tests show ciphertext at rest, correct search, and unreadable data after the tenant key is destroyed.
  Depends on STACK-037.

- [ ] SEC-005 · Data residency enforcement
  Tenant region pins storage, database and GPU processing to that region. Not enforced during the pilot. Built before the first tenant with real PHI ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when a test fails if a job for an EU tenant is scheduled on a non-EU queue.

- [ ] SEC-006 · Retention policies
  Per tenant retention for slides, annotations, reports and audit records, with legal hold.
  Done when a scheduled job test deletes expired data, skips held data and audits the deletion.

- [ ] SEC-007 · Right to access and erasure workflows
  Export all personal data for a data subject. Erase or pseudonymise on request where law allows, with reports kept per legal duty.
  Done when tests cover both workflows end to end.

- [ ] SEC-008 · Pseudonymised research workspaces
  Copying cases into a research workspace strips direct identifiers, replaces them with stable pseudonyms and removes label images.
  Done when tests prove no direct identifier, label image or macro image with a barcode reaches the research workspace.

- [ ] SEC-009 · Slide label and macro image handling
  Label and macro images can contain names and barcodes. They are stored separately, shown only to permitted roles, and excluded from guest and research access.
  Done when permission tests cover each role.

- [ ] SEC-010 · PHI-safe telemetry
  Analytics, logs, traces and error reports carry no PHI. URLs use ids, never names.
  Done when an automated scan of a full E2E run's telemetry finds no seeded patient names. The scan reads the console and file exporter output, because non-production environments do not export ([ADR 0005](adr/0005-external-sends-only-in-production.md)).

- [ ] SEC-011 · Security headers and CSP
  Strict CSP with nonces, COOP same-origin, COEP credentialless, CORP, Referrer-Policy, Permissions-Policy allowing WebHID and gamepad only where needed.
  Done when a header test runs against staging and the ONNX WASM threads and module workers still work.
  Refs doc 14.

- [ ] SEC-012 · Rate limiting and abuse protection
  Per user and per tenant limits on API and upload, bot protection on auth.
  Done when load tests show limits enforced with proper 429 responses.

- [ ] SEC-013 · Secrets management in all environments
  Done when no secret exists in the repo (scanner in CI), runtime secrets come from the secret store, and rotation is documented and tested on staging.
  Depends on STACK-037.

- [ ] SEC-014 · Backups and restore testing
  Point-in-time recovery for Postgres, versioned buckets for slides and results. TODO: confirm whether R2 supports object versioning, and if not, use write-once keys plus a protected copy.
  Done when a monthly automated restore into a scratch environment passes integrity checks.

- [ ] SEC-015 · Vulnerability management
  Container, dependency and IaC scanning with SLAs by severity.
  Done when the scanners gate CI and a weekly report is generated.

- [ ] SEC-016 · Threat model
  STRIDE threat model for upload, tile access, guest links, AI jobs and realtime.
  Done when `docs/security/threat-model.md` exists and each high risk links to a mitigation task.

- [ ] SEC-017 · Access reviews and least privilege for staff
  Break-glass access for support with justification and audit, quarterly access review export.
  Done when tests cover break-glass flow and its audit entries.

- [ ] SEC-018 · Incident response and breach notification runbook
  Done when the runbook exists, a tabletop exercise is recorded, and contacts are configured for alerting.

- [ ] SEC-019 · Policies for ISO 27001 readiness
  Information security policy, access control, supplier management, change management, business continuity, asset inventory.
  Done when the documents exist in `docs/compliance/` and each references the technical controls implementing it.

- [ ] SEC-020 · HIPAA readiness pack
  BAA template, list of subprocessors with BAAs, risk analysis, workforce training record.
  Done when the pack exists and every subprocessor in the infrastructure has a BAA status recorded.

- [ ] SEC-021 · GDPR documentation
  Records of processing, DPIA for AI-assisted diagnosis, DPA template, subprocessor list, cookie and consent policy.
  Done when the documents exist and the consent banner (if any analytics need consent) is implemented and tested.

- [ ] SEC-022 · External penetration test
  Done when an external test covers web, API, guest links and tile access, and every high finding is fixed and retested.
  Depends on M5.

- [ ] SEC-023 · Electronic signature record for sign-out
  Sign-out requires re-authentication within a short window and records meaning, signer, time and content hash.
  Done when tests prove a signed report's hash detects tampering.
  Refs REPORT-008.

---

## 33 I18N · Internationalisation readiness

- [ ] I18N-000 · Research check for i18n libraries
  Candidates: Lingui, FormatJS (react-intl), i18next with ICU. Default: Lingui with ICU messages and extraction.
  Done when an ADR exists.

- [ ] I18N-001 · String externalisation in the web app
  Done when every UI string goes through the i18n layer, an English catalogue is extracted, and a lint rule fails on raw string literals in JSX.

- [ ] I18N-002 · Locale-aware formatting
  Numbers, dates, durations, lengths (µm and mm) and percentages formatted through one module that reads the user's settings.
  Done when unit tests cover each formatter, including tabular figures for measurements.

- [ ] I18N-003 · Backend messages and report templates are locale-ready
  Report templates and emails take a locale parameter even though only English ships.
  Done when a pseudo-locale test renders a report and an email with every string translated.

---

## 05 INGEST · Slide upload, validation and indexing

Formats in scope, all read natively: Aperio SVS (JPEG and JPEG 2000), generic tiled TIFF, OME-TIFF (8 and 16 bit), Hamamatsu NDPI (including files above 4 GB), Ventana BIF, Leica SCN, Philips TIFF, Huron TIFF, ARGOS TIFF, OME-Zarr v0.4 and v0.5 (sharded). Out of scope for v1 (later epic): MRXS, iSyntax, CZI, VSI, DICOM WSI. Doc 08 has the per-format findings.

Conversion policy: the original is never altered. A conversion to OME-Zarr is produced only when a trigger fires, and the viewer then reads the converted copy while the original remains the record. Triggers are an unreadable format, a reader correctness failure that cannot be worked around, or a performance budget failure from VIEW-040. Each trigger has an ADR.

- [ ] INGEST-000 · Research check for upload and server readers
  Done when STACK-026 and STACK-039 are confirmed or revised in an ADR.

- [ ] INGEST-001 · Upload API with presigned multipart
  Create upload, get part URLs, complete, abort. Uploads land in a tenant-scoped quarantine prefix.
  Done when API tests cover the lifecycle, size limits, and that tenant B cannot complete tenant A's upload.
  Depends on STACK-039.

- [ ] INGEST-002 · Upload UI with resume
  Drag and drop or file picker on a case, per-file progress, pause, resume after reload, retry on failure, multiple files.
  Done when an E2E test interrupts a throttled 1 GB upload, reloads the page, and the upload resumes to completion.

- [ ] INGEST-003 · Ingest workflow skeleton
  Durable workflow per uploaded file: quarantine, scan, identify, validate, index, derive, publish. Each step idempotent, with status visible to the UI.
  Done when a workflow test kills the worker mid-step and the run completes after restart without duplicate outputs.
  Depends on STACK-022.

- [ ] INGEST-004 · Format identification
  Magic bytes and TIFF tag inspection to identify vendor and variant, including multi-file formats rejected with a clear message.
  Done when a table test identifies every fixture in the OpenSlide corpus and rejects unsupported formats with a named reason.
  Refs [`poc/scripts/probe-format.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/probe-format.mjs), doc 08.

- [ ] INGEST-005 · Malware and integrity scan
  Done when an EICAR test file is rejected and a truncated TIFF fails validation with a user-readable error.

- [ ] INGEST-006 · Pyramid and level validation
  Read every level's size, tile size, compression and photometric interpretation. Recover true downsample factors with the tile-padding rule. Pick the right pyramid in multi-pyramid files (Leica SCN). Record microns per pixel and objective power, with a fallback and a warning when missing.
  Done when fixture tests assert the level table for every supported format, including the SCN case that has a 1616×4668 decoy and the 36832×38432 real slide.
  Refs docs 03, 06 (confident wrong answers).

- [ ] INGEST-007 · Sidecar tile index
  For TIFF-family files, write a compact sidecar with every IFD's tile offsets and byte counts, so the browser never walks the IFD chain over the network. NDPI gets its restart-marker tile index. BIF gets its stitching layout.
  Done when browser open time on a cross-region BigTIFF drops below 1 s (POC: 4.2 s walk) in a latency-proxy test at 100 ms RTT.
  Refs docs 03, 09, [`poc/src/slide/ndpi-directory.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/ndpi-directory.ts), [`poc/src/slide/ventana.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/ventana.ts).

- [ ] INGEST-008 · Sparse tile and absent chunk map
  Resolve absent tiles once at ingest (TileByteCounts 0, missing Zarr chunks) so the viewer never paints fill colour or solid green.
  Done when fixture tests on the Philips and sparse Zarr samples show the absence map, and the viewer golden test shows background, not green or black.
  Refs doc 06.

- [ ] INGEST-009 · Seams and correctness check
  Render a sample of tiles at two levels through the server reader and compare with the browser reader output. Flag seams, colour space errors (YCbCr shown as RGB) and offset errors.
  Done when the check catches each of the POC's known failures re-introduced as test cases.
  Refs [`poc/scripts/probe-seams.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/probe-seams.mjs), doc 06.

- [ ] INGEST-010 · Thumbnail and overview image
  Done when every fixture produces a thumbnail with correct colours, checked against a golden image.

- [ ] INGEST-011 · Label and macro image extraction
  Stored separately under restricted access (SEC-009).
  Done when fixture tests extract them for SVS, NDPI and SCN where present.

- [ ] INGEST-012 · Tissue mask
  Otsu or a small model at low resolution, stored as a raster for coverage tracking, job planning and the systematic scan path.
  Done when tests on CAMELYON16 slides cover more than 98% of annotated tumour and exclude glass, with a golden mask image.
  Refs [`poc/server/app/nuclei/wsi.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/app/nuclei/wsi.py) (tissue mask at 64 px cells).

- [ ] INGEST-013 · Derived overview levels for ladder gaps
  Where a vendor pyramid skips levels and Viv's power-of-two ladder would read huge tiles, write small derived levels as a sidecar.
  Done when coarse-zoom tile reads on the affected fixtures drop from the POC's 19 to 85× cost to within 2× of a full ladder.
  Refs doc 03.

- [ ] INGEST-014 · JPEG 2000 performance decision
  Measure decode cost of J2K SVS in the browser (OpenJPEG WASM) against the VIEW-040 budgets. If it fails, the conversion trigger fires for J2K. Otherwise it stays native. HTJ2K is considered for the conversion target.
  Done when an ADR records the numbers and the decision.
  Refs [`poc/src/slide/codecs/openjpeg.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/codecs/openjpeg.ts), doc 03.

- [ ] INGEST-015 · Conversion fallback worker
  Convert to OME-Zarr v0.5 with all RGB channels in one chunk and JPEG chunks at q90 for brightfield, or lossless zstd for 16-bit and fluorescence. Write NGFF metadata. Only invoked by a trigger.
  Done when converting each trigger fixture produces a store that passes INGEST-006 and INGEST-009 and opens in Viv.
  Refs doc 32, [`poc/scripts/tiff-to-zarr.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/tiff-to-zarr.mjs), [`poc/server/tools/ome_tiff_to_zarr16.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/tools/ome_tiff_to_zarr16.py).

- [ ] INGEST-016 · 16-bit big-endian BigTIFF handling
  The browser reader misreads 64-bit offsets on big-endian BigTIFF. Detect at ingest and fix it with the sidecar index or the conversion trigger.
  Done when the MxIF fixture opens correctly.
  Refs doc 32.

- [ ] INGEST-017 · Publish step and slide status
  On success the slide becomes viewable, the case updates, and AI pre-read is enqueued (AIP-010).
  Done when an E2E test sees the slide go from uploading to processing to ready with live status.

- [ ] INGEST-018 · Ingest failure UX
  Readable errors per failure class, retry for transient failures, support contact for permanent ones.
  Done when component tests cover each failure class.

- [ ] INGEST-019 · Slide metadata editing
  Stain, block, level, slide label text (permission-gated), ordering within the case.
  Done when API and component tests cover editing and reordering.

- [ ] INGEST-020 · Bulk import tool for pilot onboarding
  A CLI that uploads a folder of slides with a CSV manifest mapping files to cases.
  Done when a test imports 20 fixture slides into 5 cases.
  Depends on CASES-006.

---

## 06 TILES · Tile delivery

- [ ] TILES-000 · Research check for tile delivery
  Done when STACK-025 is confirmed with measured CDN numbers.

- [ ] TILES-001 · Signed access to slide bytes
  Short-lived capability tokens minted by the API, scoped to tenant and slide, verified by the edge Worker without a database call ([ADR 0003](adr/0003-pilot-platform-architecture.md)), and refreshed before expiry without interrupting the viewer.
  Done when tests show expired or cross-tenant signatures are refused and a two-hour viewing session never fails a tile.

- [ ] TILES-002 · CDN in front of slide storage
  HTTP/2 or HTTP/3, Range requests through the Worker gateway, and a Cache API layer keyed per object and byte range without the token if STACK-025 shows it is needed.
  Done when the latency test shows warm tile fetch p95 under 60 ms in the same region.

- [ ] TILES-003 · Same-origin data path
  Serve slide bytes under the app origin through the CDN so CORS round trips and preflights disappear.
  Done when a test confirms no preflight and the open-time numbers match INGEST-007.
  Refs doc 09 (4.3 s to 90 ms).

- [ ] TILES-004 · Correct status codes on data paths
  No SPA fallback under data and model paths. Missing objects return a real 404.
  Done when a test requests a missing `zarr.json` and a missing model and receives 404, not HTML.
  Refs docs 06, 15.

- [ ] TILES-005 · Range coalescing for sharded Zarr
  When OME-Zarr v0.5 sharded stores are read, coalesce adjacent inner-chunk ranges.
  Done when the request count for a viewport drops as in doc 32 (194 to 39) in the latency-proxy test.

- [ ] TILES-006 · Latency proxy test harness
  A configurable RTT and bandwidth proxy used by perf tests.
  Done when perf suites can run at 0, 50, 100 and 200 ms RTT.
  Refs [`poc/scripts/latency-proxy.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/latency-proxy.mjs).

- [ ] TILES-007 · Access logging for tiles without PHI
  Done when a test confirms tile access logs carry slide id and tenant id only, and aggregate slide-open events go to the audit log once per open, not per tile.

---

## 07 VIEW · Viewer core (Viv primary, alternates behind one interface)

The viewer lives in `packages/viewer-engine`, a framework-free package that owns renderers, camera, tile loading, decode workers and overlays. React talks to it through a small typed API (STACK-006).

- [ ] VIEW-000 · Research check for the viewer stack
  Done when STACK-006, STACK-015, STACK-016 are confirmed and the ADR records the Viv and deck.gl versions in use.

### Engine foundation

- [ ] VIEW-001 · Engine package API
  Mount and unmount on a container, open slide, set camera, subscribe to camera, events for pointer on slide coordinates, overlay layer registration, dispose.
  Done when unit tests cover the API contract and a mount, unmount and remount cycle leaves no listeners (memory test from VIEW-030).

- [ ] VIEW-002 · Viv route on WebGL2 for RGB brightfield
  `MultiscaleImageLayer` or equivalent driven by our PixelSource, with a controlled view state and our own camera controller.
  Done when golden-image tests of fitted, 10× and 40× views on CMU-1.svs match in CI with software rendering.
  Refs [`poc/src/viv/baseline.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/baseline.ts).

- [ ] VIEW-003 · PixelSource interface and registry
  One interface for every format. It provides `getTile`, `getRaster`, levels, tile size, microns per pixel, photometric mode, dtype and channel info. Selection by the ingest format id, reading the sidecar index.
  Done when unit tests run the interface conformance suite against every implementation.

- [ ] VIEW-004 · Decode worker pool
  Six workers by default (tunable), transferable buffers, priority by distance to viewport centre, cancellation of queued work only, never of completed downloads.
  Done when tests prove late completed chunks are still used. A pan test reproduces the POC fix, with no fetch storm (POC regression: 10,324 fetches and 7.7 GB against a correct 19 and 14 MB).
  Refs doc 06, [`poc/src/viv/plane-pool.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/plane-pool.ts).

- [ ] VIEW-005 · Native JPEG decode with per-file validation
  Use `createImageBitmap` for JPEG tiles. At open, decode one tile both natively and through the JS decoder and compare. Fall back per file when they differ (Aperio JPEGTables splicing case).
  Done when the SVS fixture that decodes wrong natively (mean absolute error 47.7) is detected and falls back, with a golden-image test.
  Refs doc 06, [`poc/src/viv/native-jpeg.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/native-jpeg.ts).

- [ ] VIEW-006 · Shared decode cache across channels
  Viv requests R, G and B planes separately. One decode serves all three.
  Done when a test counts one decode per tile, not three.
  Refs doc 06.

- [ ] VIEW-007 · Interpolation rule
  Nearest at the finest level, linear at coarser levels, half-texel inset to avoid bleeding across tiles.
  Done when golden tests at 40× and above (digital zoom) show crisp pixels and no seams at tile borders.
  Refs doc 06.

### Format readers (each is a PixelSource)

- [ ] VIEW-010 · Generic tiled TIFF and SVS JPEG
  Done when CMU-1.svs and generic TIFF fixtures pass the conformance suite and golden images.
  Refs [`poc/src/slide/tiffsource.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/tiffsource.ts), [`poc/src/viv/tiff-source.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/tiff-source.ts).

- [ ] VIEW-011 · SVS JPEG 2000 through OpenJPEG WASM
  Lazy-loaded codec, damaged tile detection with a grey placeholder, no main-thread fallback.
  Done when J2K fixtures pass, a corrupted tile renders grey, and the codec is not downloaded for non-J2K slides.
  Refs [`poc/src/slide/codecs/openjpeg.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/codecs/openjpeg.ts), doc 24.

- [ ] VIEW-012 · OME-TIFF 8-bit and 16-bit
  Done when the 8-bit and 16-bit multichannel fixtures pass, with 16-bit going through Viv's channel contrast path.

- [ ] VIEW-013 · NDPI including above 4 GB
  Tiles cut from the restart-marker index, 64-bit offsets rebuilt, YCbCr handled.
  Done when CMU-1.ndpi and a file above 4 GB pass and colours match the golden image.
  Refs [`poc/src/slide/ndpi*.ts`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/slide).

- [ ] VIEW-014 · Ventana BIF with frame stitching
  Done when the BIF fixture shows no duplicated tissue and matches the golden image.
  Refs [`poc/src/slide/ventana.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/ventana.ts), doc 06.

- [ ] VIEW-015 · Leica SCN multi-pyramid
  Done when the main pyramid opens, not the decoy.

- [ ] VIEW-016 · Philips TIFF, Huron and ARGOS
  Done when each fixture passes conformance and golden tests, and the Huron uncompressed file does not block the main thread during zoom (POC: 100 to 200 ms per gesture).
  Refs doc 24.

- [ ] VIEW-017 · OME-Zarr v0.4 and v0.5 sharded with JPEG and lossless codecs
  zarrita store, the `imagecodecs_jpeg` codec registered in workers, NGFF 0.5 `ome` nesting, absent chunks from INGEST-008.
  Done when the converted fixtures from INGEST-015 and public IDR samples pass.
  Refs [`poc/src/slide/omezarr.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/omezarr.ts), [`poc/src/slide/codecs/jpeg-chunk.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/codecs/jpeg-chunk.ts).

- [ ] VIEW-018 · Multichannel fluorescence display
  Channel visibility, colour, contrast limits per channel, up to Viv's channel limit, contrast change in one frame.
  Done when the 16-bit fixture shows contrast changes within one frame (POC: 16 ms) in a perf test.
  Refs doc 32.

### Camera and interaction

- [ ] VIEW-020 · Camera controller
  Pan, zoom to cursor, inertia, zoom limits defined in one place, objective-based zoom presets, fly-to with duration by distance (400 to 700 ms), cancellation by any new input.
  Done when unit tests cover the camera physics and limits, and a test flies between two areas and checks the endpoint.
  Refs [`poc/src/camera/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/camera), kit motion spec.

- [ ] VIEW-021 · Wheel, trackpad and pinch handling
  Wheel zooms by default. Pinch is told apart from ctrl+wheel by delta shape. Each event is capped at half an octave. Middle-drag and Space+drag pan in any tool. Settings choose wheel mode.
  Done when unit tests replay recorded event traces from a mouse, a Mac trackpad and a Windows precision touchpad.
  Refs doc 16, doc 34 §1.

- [ ] VIEW-022 · Keyboard navigation
  Arrows pan, Shift for 3×, plus and minus zoom by 1.35×, 0 fits, Alt+1 to Alt+6 objective presets.
  Done when tests cover each binding through the key registry (CMD-001).

- [ ] VIEW-023 · Touch navigation
  One finger pans, pinch zooms, double tap to 40×, two-finger double tap for the whole slide.
  Done when Playwright touch emulation tests cover each gesture.

- [ ] VIEW-024 · Coordinate systems and units
  Level-0 pixels as the canonical space, microns through microns per pixel, screen mapping, and the "digital" label above the scan objective.
  Done when unit tests cover conversions on slides with different microns per pixel.

- [ ] VIEW-025 · Coverage tracking
  Record which tissue has been seen at 10× or more, per user and slide, persisted to the server in batches.
  Done when tests on a scripted pan path produce the expected coverage raster and percentage, and coverage survives reload.
  Refs kit W19, mock 3 and 14.

### Overlays

- [ ] VIEW-026 · Overlay layer system
  Typed layers for human annotations, AI proposals, nuclei results, heatmaps, coverage, comment pins and measurements, drawn in a fixed z-order with per-layer visibility and opacity.
  Done when golden tests render each layer type over a slide.

- [ ] VIEW-027 · Outline rendering with casings
  Class colour outline plus a thin near-black casing, proposals as near-black dashes on a white casing, brightness that never affects overlays.
  Done when golden tests match the kit specimens and a contrast test over sampled H&E pixels shows under 10% of pixels below 3:1.
  Refs doc 35 colour method.

- [ ] VIEW-028 · Overlay level of detail
  A density texture below 2 px nucleus size, dots from 2 to 7 px, outlines above 7 px. Large shapes always outlined. LOD engages only from 500 nucleus-sized shapes.
  Done when a manual measurement on the owner's Mac with 81k real nuclei, recorded as a result file, shows overlay GPU time under 1 ms at overview ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Refs doc 27, [`poc/src/annotations/lod.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/lod.ts).

- [ ] VIEW-029 · Cull grid for overlays
  Cells of 16 median nucleus diameters, contiguous ranges per row, a window 2 cells wider than the view.
  Done when a manual measurement on the owner's Mac, recorded as a result file, shows the Viv route's detail-zoom GPU time at 1.6M nuclei under 6 ms ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Refs doc 31, [`poc/src/annotations/cull-grid.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/cull-grid.ts).

### Memory, idle and robustness

- [ ] VIEW-030 · Memory and teardown correctness
  Destroy the canvas context on dispose, lose the WebGL context, remove every listener, keep one stable `selections` array per slide, upload uint8 as r8unorm, MSAA off, picking off, precomputed polygon indices.
  Done when a CI memory test opens 20 slides in sequence and the heap returns to within 10% of baseline with exactly one Deck alive.
  Refs doc 24.

- [ ] VIEW-031 · luma.gl debug-string cost patch
  Done when a perf test shows no frame over 50 ms during wheel zoom on the Huron fixture.
  Refs doc 24.

- [ ] VIEW-032 · Idle means zero work
  No animation loop callbacks when the camera, tiles and overlays are idle.
  Done when a test counts zero rAF callbacks over 10 s of idle and main-thread time under 20 ms per 10 s.
  Refs doc 24.

- [ ] VIEW-033 · Hidden tab and background scheduling
  A watchdog keeps rendering correct after the tab returns, a loop generation counter restarts parked loops, and long work is sliced with `scheduler.yield` or MessageChannel.
  Done when a test hides and shows the tab mid-load and the view is complete within 1 s of becoming visible.
  Refs docs 01, 06.

- [ ] VIEW-034 · GPU error handling
  Error scopes and uncaptured error listeners on WebGPU routes, context loss recovery on WebGL, user-facing message on unrecoverable loss.
  Done when tests force a context loss and the viewer recovers to the same view.
  Refs doc 06.

- [ ] VIEW-035 · Model inference pause during camera motion
  A shared interaction signal that background inference respects. Pause while moving, resume 200 ms after rest.
  Done when the perf test keeps 60 fps while panning during a region pass (POC without pause: 28 to 32 fps).
  Refs doc 31, [`poc/src/app/interaction.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/interaction.ts).

### Alternate renderers (developer drawer only)

- [ ] VIEW-036 · Renderer interface and route switching
  One interface implemented by Viv (primary), deck.gl 9.4 WebGPU and the custom WebGPU engine. Switching remounts cleanly and keeps the camera.
  Done when the same golden tests pass on all three routes for 8-bit RGB slides and switching 10 times passes the memory test.
  Refs [`poc/src/app/renderer.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/renderer.ts).

- [ ] VIEW-037 · deck.gl 9.4 WebGPU route
  TileLayer over BitmapLayer from the same PixelSources, SolidPolygonLayer for outlines, with known gotchas handled (redraw with a reason, minZoom, adapter limits for buffer size).
  Done when golden and perf tests pass, with uncaptured errors counted and zero.
  Refs [`poc/src/deck94/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/deck94), doc 23.

- [ ] VIEW-038 · Custom WebGPU engine route
  Render worker with OffscreenCanvas, tile atlas, compute culling, instanced polygons with instance-step attributes, 8-bit only.
  Done when golden and perf tests pass and annotation set updates take one buffer write (the POC's advantage).
  Refs [`poc/src/webgpu/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/webgpu), docs 04, 07.

- [ ] VIEW-039 · Renderer head-to-head benchmark
  Automated benchmark of the three routes on fixed camera paths with GPU-completion timing (fences, not `gl.finish`) and pixel assertions so empty frames cannot pass.
  Done when a manual benchmark run on the owner's Mac produces a result file with a table comparable with doc 31 ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Refs doc 23.

- [ ] VIEW-040 · Viewer performance budgets
  Budgets per format and RTT: time to first fitted image, time to sharp viewport after a jump, frame p95 while panning, heap ceiling.
  Done when CI enforces the CPU-side budgets on hosted runners, the frame and GPU-time budgets are checked by a manual run recorded as a result file ([ADR 0011](adr/0011-hosted-ci-only.md)), and an ADR records the numbers derived from the POC.
  Depends on TEST-006.

---

## 31 LAB · Developer drawer and HUD

- [ ] LAB-000 · Research check
  Done when the drawer's control list is confirmed against doc 34 lab-tagged leaves and kit W25.

- [ ] LAB-001 · Developer drawer
  Opens with Ctrl+Shift+D or `?lab`, only for users with the developer permission. Renderer, culling, detail level, interpolation, synthetic nuclei, prefetch, motion vector, HUD, pause models.
  Done when component tests cover each control and a permission test hides it from doctors.
  Refs mock 17, kit W25.

- [ ] LAB-002 · Performance HUD
  Fps, frame time, resident tiles, inflight requests, atlas use, decode p95, annotations drawn and culled, LOD tier. Floats in a free corner and can be hidden.
  Done when a test confirms the HUD costs under 0.5 ms per frame.
  Refs [`poc/src/app/hud.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/hud.ts).

- [ ] LAB-003 · Sample slides and synthetic data
  Format samples and CAMELYON slides loadable for developers, synthetic nuclei at 100k and 1M, with a visible "synthetic" chip.
  Done when tests confirm synthetic layers are always labelled.
  Refs doc 25.

- [ ] LAB-004 · Pan sweep benchmark and export
  Done when the sweep runs from the drawer and exports CSV.
  Refs [`poc/src/app/benchmark.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/benchmark.ts).

- [ ] LAB-005 · Debug handle
  A typed `window.__parfocal` handle in non-production builds for tests and debugging.
  Done when E2E tests use it to read camera state.

---

## 08 DS · Design system

- [ ] DS-000 · Research check for the design system tooling
  Done when STACK-007 is confirmed and Storybook (or the chosen catalogue) is set up.

- [ ] DS-001 · Design tokens package
  Product tokens from the kit for dark and light: page, chrome, chrome-2, chrome-3, canvas, line, line-strong, fg, fg-dim, fg-faint, accent, accent-fill, accent-soft, on-accent, ok, warn, bad, future, pin, plus class colours and the proposal colour. Spacing on a 4 px grid, radii 4, 7 and 10. Exported as CSS variables and TS constants.
  Done when unit tests assert every token exists in both themes and a visual test renders the specimen page.
  Refs kit Design system page, mock token block.

- [ ] DS-002 · Colour measurement scripts in CI
  WCAG 2 contrast and APCA Lc 60 or more for every text pair, CIEDE2000 between classes after protan, deutan and tritan simulation (Machado), outline contrast over sampled real H&E pixels.
  Done when CI fails if a token change breaks any threshold, with the doc 35 numbers as the baseline (closest class pair 15.1 under deuteranopia, proposals at least 40 from every class).
  Refs doc 35, kit decision D12.

- [ ] DS-003 · Typography
  IBM Plex Sans and IBM Plex Mono, self-hosted. Scale is display 26/600, title 17/600, body 13/400, label 11/600 caps, data 12 mono with tabular figures. Nothing below 11 px.
  Done when the type specimen story passes visual tests and fonts load without layout shift.

- [ ] DS-004 · Icon set with key badges
  The SVG icon set from the mock (select, hand, smart, auto, poly, free, rect, ellipse, marker, ruler, arrow, text, comment, brush, slides, sun, gear, help, share, back, next, popout, device icons, panel, home, check, warn, eye, lock, search, flag and others) as React components. Tools show their key letter.
  Done when every icon has a story and an accessible name.

- [ ] DS-005 · Theme switching
  System, dark and light, with the user setting stored per device. Neutral chroma near zero for chrome.
  Done when visual tests cover both themes for every component.

- [ ] DS-006 · Buttons and icon buttons
  Primary, secondary, ghost. States are default, hover, pressed, focus and disabled. Inline key hints. 32 px height, 24 px minimum target.
  Done when stories, interaction tests and axe pass.

- [ ] DS-007 · Segmented control, toggle, slider, stepper
  Done when stories, keyboard tests and axe pass.

- [ ] DS-008 · Chips and status pills
  Firm, open, neutral, settled, above cutoff, needs review, not validated, running, future tag, STAT badge.
  Done when stories exist for each variant in both themes.

- [ ] DS-009 · Keycap component
  Done when keycaps render the user's current binding from the key registry, not a hard-coded letter.

- [ ] DS-010 · Tool rail button
  38 px, key badge, active state, AI dot.
  Done when stories and tests cover each state.

- [ ] DS-011 · Popover, dialog, menu, tooltip, toast
  Toasts last 1.6 s by default and never cover the slide centre.
  Done when focus trapping, Esc handling and axe tests pass.

- [ ] DS-012 · Inspector primitives
  Section label, card, warn bar, region row, class bars, verdict card with range bar (band, point, dashed cutoff, axis labels).
  Done when stories render the mock 4 data and a unit test checks the range bar geometry.

- [ ] DS-013 · Gallery tile
  92 px and 120 px sizes. States are to check, current, done. Dashed ring on the cell, label in AI wording.
  Done when stories and tests cover each state.

- [ ] DS-014 · Avatar, avatar stack, presence dot
  Done when stories exist and colours come from the user profile.

- [ ] DS-015 · Skeletons and placeholders that hold space
  Nothing jumps when data arrives.
  Done when a layout-shift test on the case inspector reports a CLS of zero while findings stream in.
  Refs kit W18.

- [ ] DS-016 · Motion tokens and reduced motion
  Durations 120 to 400 ms, easing tokens, a slow presenting mode at one third speed, reduced motion turns every transition into a cut.
  Done when tests run with `prefers-reduced-motion` and assert no animation.
  Refs kit motion page.

- [ ] DS-017 · Density modes
  Comfortable and compact.
  Done when visual tests cover both densities for lists and inspector.

---

## 09 SHELL · Application shell and layout

- [ ] SHELL-000 · Research check
  Done when STACK-003 and STACK-005 are confirmed for the shell.

- [ ] SHELL-001 · Routes and code splitting
  Home, worklist (with view param), case (with slide and camera in the URL), settings deep links, admin, guest view. The viewer engine is split into its own chunk.
  Done when routing tests cover deep links and the initial home bundle stays under the budget set in TEST-006.

- [ ] SHELL-002 · Global top bar for home and worklist
  Organisation switcher, search field opening the palette, settings, avatar menu.
  Done when component and E2E tests cover each control.
  Refs mock 1 and 2.

- [ ] SHELL-003 · Case top bar
  Back to worklist, patient block (name, sex, age, masked MRN, or initials when hidden), case and slide line, slide switcher with Q and E, Review and Annotate switch, viewed ring, share, panel toggle, settings, help, and the permanent primary sign-out button.
  Done when component tests cover each element and E2E covers keyboard access to all of them.
  Refs mock §2.1, kit W2.

- [ ] SHELL-004 · Workspaces Review and Annotate
  Switching changes the rail, the drag behaviour (pan in Review, marquee in Annotate) and the inspector defaults, without moving the slide.
  Done when tests assert the camera is unchanged across a switch.

- [ ] SHELL-005 · Inspector panel with resize and hide
  Default 340 px, drag between 280 and 560, drag below 220 hides it, I toggles it, a floating tab shows the active section and count when hidden. Option "hides while panning".
  Done when interaction tests cover resize, hide, restore and persistence per user.
  Refs kit W10, mock §2.3.

- [ ] SHELL-006 · Left rail and bottom dock layouts
  The rail by default. A bottom dock in the Figma UI3 style as a setting, moving the magnification bar and context bar accordingly.
  Done when visual tests cover both layouts for Review and Annotate.
  Refs kit W9, decision D6.

- [ ] SHELL-007 · View transitions
  Worklist to case (the row grows into the canvas), tile to focus review, sign-out back to the worklist. Built on the View Transitions API, with a new key press cancelling the current transition.
  Done when tests confirm input is never blocked during a transition and reduced motion cuts.
  Refs kit motion table.

- [ ] SHELL-008 · Focus mode
  Cmd+\ hides the top bar, rail and inspector, shows the focus pill and the area card, keeps the minimap and magnification bar.
  Done when E2E covers enter and exit and the screen-coverage measurement drops to the expected value.
  Refs mock 13, kit W23.

- [ ] SHELL-009 · Screen coverage measurement
  A test utility that measures the share of the canvas covered by chrome at 1280, 1440 and 1920 widths.
  Done when CI enforces under 35% in Review at 1440×900 (KPI).
  Refs doc 35.

- [ ] SHELL-010 · Global error and empty states
  Offline banner, session expired, permission denied, not found, server error.
  Done when component tests cover each state.

- [ ] SHELL-011 · Second-monitor pop-out windows
  The minimap and the inspector can pop out into a second window that stays in sync (BroadcastChannel), using the Window Management API where available.
  Done when an E2E test with two pages confirms camera sync both ways.
  Refs doc 35, mock 5 pop-out icon.

---

## 10 HOME · Home variants

All variants ship behind flags and the user can switch between them in settings. EXP-003 runs the A/B assignment.

- [ ] HOME-000 · Research check
  Done when the data each variant needs is mapped to API endpoints in an ADR.

- [ ] HOME-001 · Home API aggregates
  Resume target (case, slide, area, cell), due counts, recent cases, department numbers, upcoming tumor boards, announcements.
  Done when API tests cover each aggregate with tenant isolation.

- [ ] HOME-002 · Variant A Launchpad
  Greeting with date and due summary, resume card with "Resume" and "Open from the start", four quick actions, recent cases with thumbnails, side column with department numbers, coming up and announcements.
  Done when component tests match mock 1 scene A and E2E resumes at the exact saved view.

- [ ] HOME-003 · Resume state
  Persist the last case, slide, camera, workspace, area and review position per user.
  Done when E2E closes the browser mid-review and resumes at the same cell.

- [ ] HOME-004 · Variant B Department dashboard
  Today, week and month toggle. KPIs for received, AI pre-read share, median turnaround against target, STAT open, second opinions. Pipeline funnel, team load with rebalance suggestion, turnaround chart, needs-attention list.
  Done when component tests render seeded data and permission tests restrict it to lab leads and admins.

- [ ] HOME-005 · Department metrics pipeline
  Turnaround, throughput and funnel computed from case and job events.
  Done when unit tests compute metrics from a seeded event log.

- [ ] HOME-006 · Rebalance suggestion
  Suggest moving cases between pathologists by load and specialty. The suggestion only proposes, and a lead confirms.
  Done when unit tests cover the heuristic and E2E applies a suggestion with an audit entry.

- [ ] HOME-007 · Variant C Workspace feed
  Filters everything, mentions, my cases, AI. Events with avatar, text, quote and time. Spaces cards and tumor boards.
  Done when component tests render seeded events and the feed updates in realtime.
  Depends on COLLAB-001.

- [ ] HOME-008 · Variant D Search first
  Big search box with scope chips (all, patients, cases, slides, reports, folders, actions), grouped results, a patient result that groups cases across years.
  Done when E2E searches a partial surname and opens a historic report.
  Depends on CASES-009.

- [ ] HOME-009 · Announcements and tumor boards
  Lab admins post announcements. Tumor boards with date, room, case list and lock time.
  Done when API and component tests cover create, list and expiry.

- [ ] HOME-010 · Role-based default home
  Launchpad for everyone, dashboard for lab leads, overridable in settings.
  Done when tests cover defaults per role and the override.

---

## 11 WL · Worklist variants and AI queue

- [ ] WL-000 · Research check
  Done when the worklist query API and the five views' data needs are captured in an ADR.

- [ ] WL-001 · Worklist query API
  Filter by assignee, folder, status, due, priority, AI state, shared with me, starred, signed. Sort by due and priority. Cursor pagination.
  Done when API tests cover every filter and tenant isolation.

- [ ] WL-002 · Worklist sidebar
  Home, my worklist, shared with me (badge), starred, signed out, folders by service with colours and counts.
  Done when component tests cover navigation and counts.

- [ ] WL-003 · AI status line
  The segmented bar and the sentence "The AI has read 6 of 8 cases ...", with a link to the queue.
  Done when component tests cover every AI state mix.

- [ ] WL-004 · AI cell and dot semantics
  Dot colours and one-sentence AI result per case. Red means tumor flagged, green nothing flagged, blue reading, amber decision needed, grey no model applies. Progress bar while running.
  Done when unit tests map every case AI state to its dot and sentence.
  Refs mock 2 caption.

- [ ] WL-005 · View A Inbox list
  Due today and coming up groups. Row has patient, STAT badge, sex, age, masked MRN, case id, specimen, slide count, AI cell, status, assignee avatars, due.
  Done when component tests match mock 2 scene A and the list virtualises 10,000 rows.

- [ ] WL-006 · Keyboard navigation in the worklist
  J and K move, Enter opens, P toggles the preview, Esc clears selection.
  Done when E2E drives the whole list by keyboard.

- [ ] WL-007 · View B List with preview
  Compact list plus preview pane (thumbnail with faint AI map, verdict card, slide strip, clinical note, open and reassign).
  Done when component tests match mock 2 scene B.

- [ ] WL-008 · View C Status board
  Columns AI reading, ready to review, waiting on others, draft report, signed today. Dragging to waiting on others opens the second-opinion flow.
  Done when E2E drags a card and a second-opinion request is created.
  Depends on COLLAB-008.

- [ ] WL-009 · View D Day plan
  Timeline 9:00 to 16:00 with a now line, cases placed by due time and estimated reading time, fixed commitments, unscheduled list, re-plan.
  Done when unit tests cover the estimate (slide count, specimen, AI pre-read) and the placement algorithm.

- [ ] WL-010 · Reading-time estimate model
  A simple estimate from slide count, specimen type and AI result, calibrated later from task timing (EXP-006).
  Done when unit tests cover the formula and it is versioned.

- [ ] WL-011 · View E Slide grid
  Card per case with thumbnail and faint AI map, progress ring and time left while running.
  Done when component tests cover ready, running and queued cards.

- [ ] WL-012 · View switcher and persistence
  List, preview, board, day, grid toggle, remembered per user, overridden by experiment assignment when one is active.
  Done when tests cover persistence and experiment override.

- [ ] WL-013 · Hide names
  Swap names for initials across the app for screen sharing and teaching.
  Done when E2E confirms no full name appears anywhere in the DOM with the toggle on.

- [ ] WL-014 · AI queue panel
  Jobs per slide in run order, stage pills (scan, tissue, tumor map, cells), ETA, throughput sparkline, held job with run anyway or skip AI, pause queue, run STAT first.
  Done when component tests match mock 2 queue scene and API tests cover each action with permissions.
  Depends on AIP-010.

- [ ] WL-015 · Star, assign, reassign
  Done when API and E2E tests cover each action with audit entries.

- [ ] WL-016 · Realtime worklist updates
  New cases, AI progress and status changes update without reload.
  Done when E2E with two sessions shows an update within 2 s.
  Depends on COLLAB-001.

- [ ] WL-017 · Filter popover
  Folder, due date, AI result, person.
  Done when component tests cover combined filters and URL persistence.

---

## 12 CASE · Case view

- [ ] CASE-000 · Research check
  Done when the case view state model (slide, workspace, inspector tab, area, review position) is captured in an ADR.

- [ ] CASE-001 · Case loader
  Load case, patient, slides and AI state, open the first slide fitted.
  Done when E2E opens a case from the worklist and the slide is fitted within the TEST-006 budget.

- [ ] CASE-002 · Slide tray
  Thumbnails of the case's slides with block and stain labels, Q and E to switch, backslash toggles the tray, compare entry point.
  Done when tests cover switching, and switching preserves per-slide camera.
  Refs mock 3, kit W2.

- [ ] CASE-003 · Per-slide view memory
  Each slide remembers its camera while the case is open.
  Done when tests switch slides and come back to the same view.

- [ ] CASE-004 · AI state: pre-read ready
  Heat overlay, area outlines with numbered badges, verdict sentence with chip, "where to look" list, go-to-area button.
  Done when component tests match mock 3 ready scene.

- [ ] CASE-005 · AI state: still running
  The map fills in as computed, with a dashed line where the AI has reached. Stage progress card. Areas appear as found, with placeholders. The view never moves.
  Done when E2E with a simulated job stream shows areas appearing and zero layout shift.
  Refs kit W18.

- [ ] CASE-006 · AI state: no tumor flagged
  "Needs review" chip (never "negative"), systematic scan path at 10× in reading order, coverage bar, start systematic scan.
  Done when tests confirm the path covers the tissue mask and the scan advances one field per step.
  Refs kit W19.

- [ ] CASE-007 · Systematic scan mode
  Step field by field along the serpentine path with a key, marking seen tissue.
  Done when E2E completes a scan on a small slide and coverage reaches 100%.

- [ ] CASE-008 · AI state: model not validated
  Warning bar, areas shown for reference only, no verdict, amber chip.
  Done when component tests cover the state and the report draft notes it.
  Depends on AIP-005.

- [ ] CASE-009 · Viewed ring
  Share of tissue seen at 10× or more, in the top bar, opens peek on click.
  Done when tests check it against the coverage raster.

- [ ] CASE-010 · Patient banner
  Lab-locked setting that keeps name, sex, age and record number visible on every case screen.
  Done when tests cover the setting and initials mode.

- [ ] CASE-011 · Case header details
  Specimen, clinical note, clinical question, blocks, assigned pathologist.
  Done when component tests cover each field and missing data.

- [ ] CASE-012 · Case state transitions
  Scanned, AI reading, to review, waiting on others, draft report, signed, amended.
  Done when unit tests cover the state machine and every transition is audited.

---

## 13 NAV · Navigation aids

- [ ] NAV-000 · Research check
  Done when the minimap state machine and placement algorithm are written as an ADR from kit and mock specs.

- [ ] NAV-001 · Magnification bar
  Presets 1.25×, 2.5×, 5×, 10×, 20×, 40× with Alt+1 to Alt+6, nearest preset highlighted, option to label as zoom percent.
  Done when tests cover preset jumps and highlighting at intermediate zooms.
  Refs mock §2.6.

- [ ] NAV-002 · Scale bar and readout
  Nice values from 10 µm to 5 mm, mm at 1000 µm and above, readout with objective and microns per pixel, "digital" above the scan objective.
  Done when unit tests cover the scale bar choice at every zoom.

- [ ] NAV-003 · Slide brightness dial
  Popover with slider from 20 to 140%, Alt+Up, Alt+Down, Alt+0 reset. Affects the slide only, never the UI or overlays. Remembered per device. Accent colour when not 100%.
  Done when golden tests confirm only slide pixels change and overlays keep their colour.
  Refs mock §2.7, kit D11.

- [ ] NAV-004 · Area list and go to area
  Areas sorted by size with real dimensions and category (macro, micro, ITC size), G then n flies to area n, `[` and `]` go to previous and next.
  Done when E2E flies to each area and marks it visited at 10× or more.

- [ ] NAV-005 · Edge cues
  Pills at the screen edge pointing to off-screen areas with their distance, clickable to fly there.
  Done when unit tests cover cue placement and distance, and E2E clicks a cue.
  Refs mock §2.8, NaviPath evidence.

- [ ] NAV-006 · Smart minimap state machine
  States hidden, reading, area, locator, travel, faded and peek, with the transitions from the kit spec (hidden while more than half the tissue is on screen, area mapping from 20×, locator in focus review, travel on `]` or G+n, faded within 40 px of the pointer).
  Done when model-based tests drive every transition.
  Refs kit Interaction spec, mock 5. Built on STACK-005 state machine choice.

- [ ] NAV-007 · Minimap placement scoring
  Score each corner by preference plus weighted hot points under it (tumor edge, measurement, current cell, doubtful cells, proposals, pins) plus blocks for chrome. The lowest score wins, ties go to bottom right. Move with a 300 ms ease, never while panning.
  Done when unit tests reproduce the mock's placement decisions for each scene.
  Refs mock 5 placement algorithm.

- [ ] NAV-008 · Minimap content
  Seen trail, area outlines with badges, viewport rectangle (crosshair below 8 px), cell dots in area mode, header and footer text, click and drag to move.
  Done when golden tests cover reading, area and travel modes.

- [ ] NAV-009 · Minimap settings
  When useful, always, never.
  Done when tests cover each mode.

- [ ] NAV-010 · Whole-slide peek
  Hold Z for the whole slide over a dimmed case, tap Z toggles the last two magnifications (hold registers after 180 ms). Click a place to go there, release to return. Seen trail, AI areas, checked ticks, you-are-here box.
  Done when E2E covers hold, tap, click-to-go and release.
  Refs mock 14, kit W12.

- [ ] NAV-011 · Travel animation and route line
  Camera flight with a route line to the target, skip with `]` again.
  Done when tests confirm a new key press cancels the flight at its current position.

- [ ] NAV-012 · Zoom to selection
  Shift+2 zooms to the selected shape or area.
  Done when a test confirms the selection is fitted with margin.

---

## 14 REVIEW · Review workspace

- [ ] REVIEW-000 · Research check
  Re-read docs 28 and 33 and confirm the confidence rules below still hold for the typer chosen in AINUC.
  Done when an ADR lists the display rules and their evidence.

- [ ] REVIEW-001 · Review rail
  Five tools: select V, hand H, ruler L, comment C, smart select S (routes to Annotate).
  Done when component tests cover each tool and routing.

- [ ] REVIEW-002 · Findings tab layout
  Verdict first, then evidence, then cells (the xPath order). Model warning bar on top when needed.
  Done when component tests match mock 4.

- [ ] REVIEW-003 · Verdict computation API
  Per area, the share of the cutoff class with the expected-mistakes range (sum of probabilities in both directions), the cutoff from lab settings, and the state firm, open, above cutoff, settled or not validated.
  Done when unit tests reproduce doc 33's examples and the property that firm answers are never wrong on the validation fixture.
  Refs doc 33.

- [ ] REVIEW-004 · Verdict card and range bar
  Plain-words heading, chip, sub-line, range bar with band, point and dashed cutoff on one scale.
  Done when component tests cover every state.

- [ ] REVIEW-005 · Class composition bars
  Counts per class for the area.
  Done when component tests render seeded counts.

- [ ] REVIEW-006 · Cells to check selection
  Contested-first order (tumor probability nearest 50%), within the area, excluding reviewed cells, pages of 12.
  Done when unit tests confirm ordering and paging on a seeded result.
  Refs doc 33, mock 7.

- [ ] REVIEW-007 · Cells gallery in the inspector
  Twelve tiles, the slide follows the highlighted tile, rest look right (Shift+K), next 12 (Shift+J), click a tile to enter focus review.
  Done when E2E reviews a page and every decision is persisted.

- [ ] REVIEW-008 · Settled rule
  The verdict settles when the range can no longer cross the cutoff. Chip moves from open to settled with a toast "You can stop here".
  Done when unit tests cover the rule and E2E sees the toast after the expected number of decisions.

- [ ] REVIEW-009 · Focus review one cell at a time
  Cell at 40× with others faded to 18%, dashed ring, review HUD with K keep, 1 to 4 set type, X not a cell, J skip, Shift+J back, Esc to gallery. Minimap shrinks to the locator.
  Done when E2E reviews 12 cells by keyboard only and the HUD never covers the cell.
  Refs mock 8, kit W5.

- [ ] REVIEW-010 · Review decisions API
  Keep, retype, not a cell, skip, with reviewer, time, AI call and confidence at decision time. Reviewed shapes are never re-typed by a model afterwards.
  Done when API tests cover each decision and the "never re-typed" rule.
  Refs doc 22.

- [ ] REVIEW-011 · AI wording modes
  Plain words (default), percent, frequency, with the validated phrases "tumor", "probably tumor", "tumor or immune".
  Done when unit tests map calibrated probabilities to phrases with the doc 28 band thresholds.

- [ ] REVIEW-012 · Outline display modes
  Fade (default, opacity from calibrated probability), mark unsure, bands, with the formulas from the mock.
  Done when golden tests cover each mode.
  Refs mock §2.4, doc 33.

- [ ] REVIEW-013 · Track record by confidence band
  Per user and typer, the share of calls kept per band, persisted server-side. An overall figure is shown only when every band that matters has enough checks.
  Done when unit tests cover the band split and the threshold for showing an overall figure.
  Refs doc 33.

- [ ] REVIEW-014 · Model warnings
  Typer under 70% on its own test set, uncalibrated, out of distribution (confident share far below the test set's), not validated for this specimen.
  Done when unit tests trigger each warning from model metadata and slide statistics.
  Refs docs 28, 29.

- [ ] REVIEW-015 · Paged results keep confidence
  The cells gallery and fade work on paged whole-slide results because the chunk schema carries probabilities.
  Done when E2E reviews cells on a 1M-nucleus paged result.
  Depends on AINUC-003.

---

## 15 ANN · Annotate workspace

- [ ] ANN-000 · Research check
  Compare current tooling conventions (QuPath, CVAT, Figma, the SAM-based QuPath extension) with the kit key map and confirm the geometry library choice for the client (for example earcut, clipper2, turf).
  Done when an ADR exists.

- [ ] ANN-001 · Annotation document model in the client
  Shapes (polygon, freehand, rectangle, ellipse, point marker, ruler, arrow, text, brush region), class, group, provenance (human, model name and version), review state, comments link. Editable shapes separate from columnar model runs.
  Done when unit tests cover create, update, delete and promotion of a run piece to a shape.
  Refs [`poc/src/annotations/document.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/document.ts), `runs.ts`, doc 11.

- [ ] ANN-002 · Annotate rail with five families
  Navigate (V, H), AI (S, U), draw (P, Shift+P, R, O, M), note (L, Shift+L, T, C), paint (B).
  Done when component tests cover every tool and its key from the registry.
  Refs mock §2.2.

- [ ] ANN-003 · Context bar
  One floating bar with the active tool's options and Discard and Accept, replacing conditional rows.
  Done when component tests render the context bar for every tool per the mock CTX table.
  Refs mock §2.9.

- [ ] ANN-004 · Select tool
  Click selects, Shift+click toggles (only if moved less than 3 px), marquee on empty space, move with axis lock, vertex and edge reshape with 45° snap, double-click edge adds a point, double-click point removes it.
  Done when interaction tests replay each gesture.
  Refs doc 16.

- [ ] ANN-005 · Polygon tool
  Click adds a vertex, Enter, double-click or click on the first vertex closes, Shift snaps 45°, switching tool finishes a polygon of 3 or more vertices.
  Done when interaction tests cover each path.

- [ ] ANN-006 · Freehand tool
  Coalesced pointer events, simplification on release.
  Done when tests confirm the stroke uses coalesced events and simplifies within tolerance.
  Refs doc 24.

- [ ] ANN-007 · Rectangle and ellipse tools
  Shift makes squares and circles.
  Done when interaction tests cover both.

- [ ] ANN-008 · Count marker tool
  Click drops a marker of the active class, counts per class in the context bar and layers.
  Done when tests cover counting and deletion.

- [ ] ANN-009 · Arrow and text tools
  Text commits on Enter, drops on Esc (undo restores it).
  Done when interaction tests cover both.

- [ ] ANN-010 · Brush tool on heatmaps
  Paint and erase (Shift) on a heatmap layer, size 4 to 160 px.
  Done when tests cover painting, erasing and undo, and the painted map persists.

- [ ] ANN-011 · Classes and keys 1 to 4
  With nothing selected, sets the class for new shapes. With a selection, re-classes it. In review contexts it also marks reviewed and teaches. The swatch click and the key behave the same (fixes the POC inconsistency).
  Done when tests confirm identical behaviour for key and swatch.
  Refs doc 34 inconsistencies.

- [ ] ANN-012 · Class taxonomy per tenant
  Default classes tumor, stroma, immune, other with kit colours. Lab admins can extend per specimen type, with colour validation from DS-002.
  Done when API tests cover custom classes and the colour check rejects a colour too close to an existing class.

- [ ] ANN-013 · Undo and redo
  Transactions: draft vertex, then prompt point, then committed edit. A model run accept is one step. Async results arriving after accept fold into the accept entry. Group operations and comments are covered.
  Done when unit tests cover the ordering rules and a property test round-trips random edit sequences.
  Refs [`poc/src/annotations/history.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/history.ts), docs 10, 16, 17.

- [ ] ANN-014 · Esc ladder
  Close overlays, then comment card, cancel drag, discard draft, stop model run or discard proposals, deselect vertex, clear selection, leave focus review, back to select tool, close panel. Inputs keep their own Esc.
  Done when a table-driven test asserts the layer peeled in every state.
  Refs doc 30, kit Interaction spec.

- [ ] ANN-015 · Layers tab
  Groups with counts, visibility (A toggles overlays), lock, colour, nested children, group by class, cluster, region or source, target layer for new shapes, Cmd+G group and Cmd+Shift+G ungroup.
  Done when component and interaction tests cover each control. Hidden and locked groups are excluded from hit testing.
  Refs mock 9, doc 34 §6.

- [ ] ANN-016 · Grouping rules
  Class, cluster (radius in µm), containment, provenance.
  Done when unit tests cover each rule.
  Refs [`poc/src/annotations/grouping.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/grouping.ts).

- [ ] ANN-017 · Proposals lifecycle
  Pending proposals are visible in any tool, accept and discard from anywhere, accepted output never becomes the active group.
  Done when tests cover accept and discard from each tool.
  Refs doc 25.

- [ ] ANN-018 · Hit testing at scale
  Spatial index for shapes and runs, ignoring hidden and locked groups.
  Done when a perf test keeps hover hit tests under 1 ms with 1M nuclei.

- [ ] ANN-019 · Overlay drawing performance
  Paths batched per state, `getBoundingClientRect` cached per frame, one overlay paint per frame, no quadratic `closePath` on batched paths.
  Done when the overlay perf test meets the TEST-006 budget during a drag with 100k shapes.
  Refs doc 24.

- [ ] ANN-020 · Annotation persistence API
  CRUD with versioning, append-only history, bulk operations, tenant isolation, PostGIS geometry in level-0 coordinates.
  Done when API tests cover CRUD, history and bulk accept of 10,000 shapes under the latency budget.
  Depends on STACK-021.

- [ ] ANN-021 · Autosave with optimistic updates and retry
  Every edit saves in the background with batching, an offline-tolerant retry queue and a visible save state. A leave-page guard triggers only when unsaved edits exist.
  Done when E2E edits, cuts the network for 30 s, restores it, and no edit is lost.

- [ ] ANN-022 · Concurrent edit protection
  Version checks on save, conflict message when two users edit the same shape.
  Done when tests cover the conflict path.

- [ ] ANN-023 · Import GeoJSON and own JSON
  Merge into a new group by default, never replace silently. Undoable. Reads QuPath GeoJSON and the app's own export.
  Done when round-trip tests export and re-import with no loss, including groups, comments and review state.
  Refs doc 25 import defects.

- [ ] ANN-024 · Export GeoJSON, FlatGeobuf and own JSON
  Runs are included (the POC once exported "0 shapes"), large results stream from the server.
  Done when tests export a 100k-run result and count every feature.

- [ ] ANN-025 · Review CSV export
  Model type against final class per reviewed shape.
  Done when a unit test checks columns and counts.

- [ ] ANN-026 · Delete and clear with confirmation
  Clear removes everything as one undoable step with confirmation over a threshold. Deleting a shape removes its orphaned comments.
  Done when tests cover undo of clear and comment cleanup.

- [ ] ANN-027 · Run piece promotion and pruning
  Promote run pieces to shapes on edit or in bulk (confirm above 5,000), drop least confident pieces.
  Done when tests cover promotion and pruning with undo.

- [ ] ANN-028 · Annotation audit and provenance display
  Who created, edited and reviewed each shape, with model name and version for AI output.
  Done when component tests show provenance in the shape popover.

---

## 16 MEAS · Measurements

- [ ] MEAS-000 · Research check
  Done when the measurement categories per specimen (macro over 2 mm, micro 0.2 to 2 mm, ITC under 0.2 mm) are confirmed from current staging guidance and recorded in an ADR.

- [ ] MEAS-001 · Ruler tool
  Drag to measure with the value on the line in mono digits, Shift snaps to 45°, double-click snaps to the long axis of the area under the pointer.
  Done when unit tests cover length in µm on slides with different microns per pixel and the long-axis snap.
  Refs mock 6.

- [ ] MEAS-002 · Area and perimeter for closed shapes
  Done when unit tests check areas against analytic shapes.

- [ ] MEAS-003 · Measurement list in the inspector
  Each measurement with area, value, time, category chip.
  Done when component tests cover the list.

- [ ] MEAS-004 · Report linkage
  The largest relevant measurement fills the report's largest deposit and category with its source named.
  Done when E2E measures and the report draft shows the value and source.
  Depends on REPORT-004.

- [ ] MEAS-005 · Units setting
  µm and mm automatically or always µm.
  Done when tests cover both settings.

---

## 17 COLLAB · Comments, realtime and second opinion

- [ ] COLLAB-000 · Research check
  Done when STACK-024 is confirmed and the event model (topics per tenant, case and user) is written as an ADR.

- [ ] COLLAB-001 · Realtime infrastructure
  Authenticated connections to Durable Object rooms per case and per user, fan-out from API events, refetch on reconnect ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when tests confirm a user never receives another tenant's events and a reconnecting client refetches and converges on the current state.

- [ ] COLLAB-002 · Threads API
  Threads anchored to a slide point, a shape or a group, with title, messages, resolve and reopen, delete with confirmation when replies exist.
  Done when API tests cover anchors, permissions and audit.

- [ ] COLLAB-003 · Comment tool and pins
  C places a pin and opens the composer, Enter posts, Shift+Enter adds a line. Pins show initials, store an offset relative to their target, follow and hide with their shape, and are draggable with undo.
  Done when interaction tests cover placing, dragging and following a moved shape.
  Refs doc 15, mock 10.

- [ ] COLLAB-004 · Thread popover
  Title, resolve, close, messages with relative time, reply field, measurement embed.
  Done when component tests cover the popover.

- [ ] COLLAB-005 · Comments tab
  Open and resolved toggle, thread cards, go to location, new comment.
  Done when component tests cover filtering and navigation.

- [ ] COLLAB-006 · Mentions
  At-mention colleagues in a message, which notifies them.
  Done when tests cover mention parsing and notification.
  Depends on NOTIF-001.

- [ ] COLLAB-007 · Presence
  Who is viewing a case now, shown on the case and in the second-opinion card.
  Done when E2E with two users shows presence within 2 s and it clears on leave.

- [ ] COLLAB-008 · Ask for a second opinion
  Pick a colleague (same organisation or guest from another), send the current view and its threads, create a guest link when external, move the case to waiting on others.
  Done when E2E covers internal and external requests end to end.
  Depends on IAM-010.

- [ ] COLLAB-009 · Guest view
  A guest opens the case at the exact view without installing anything, can measure and reply, sees only the shared threads. Initials mode is on while a guest is viewing.
  Done when E2E covers the guest journey and permission tests confirm the limits.

- [ ] COLLAB-010 · Follow my view
  A user can share their live camera and others can follow until they move.
  Done when E2E with two pages shows the follower's camera tracking within 300 ms.

- [ ] COLLAB-011 · Live shared cursor in compare and follow modes
  Done when tests cover cursor broadcast throttling and display.

- [ ] COLLAB-012 · Open threads at sign-out
  Sign-out warns on open threads but does not block.
  Done when E2E signs out with an open thread and sees the warning.

---

## 18 CMP · Compare slides

- [ ] CMP-000 · Research check
  Done when the linking model (pan, zoom, rotation, manual offset) is written as an ADR.

- [ ] CMP-001 · Split viewer layouts
  1, 2 side by side, 2 stacked, 4.
  Done when golden tests cover each layout and the memory test passes with four viewers.

- [ ] CMP-002 · Linked views
  Pan, zoom and rotation move all panes by default, Shift+L unlinks for manual alignment, relink keeps the manual offset.
  Done when unit tests cover linking with an offset.
  Note that Shift+L is also the arrow tool in Annotate, so CMD-004 resolves the conflict.

- [ ] CMP-003 · Shared cursor
  The same point is shown on every pane.
  Done when tests cover cursor mapping with offsets.

- [ ] CMP-004 · Pane slide picker
  Pick any slide of the case per pane from the tray.
  Done when E2E opens H&E and IHC side by side from the tray.

- [ ] CMP-005 · Rotation support
  Rotate a pane for alignment, off by default for input devices.
  Done when tests cover rotation in linked mode.

- [ ] CMP-006 · Semi-automatic alignment
  Optional coarse registration from thumbnails to propose an initial offset.
  Done when a test aligns two serial-section fixtures within a tolerance, or an ADR defers it.

---

## 19 REPORT · Reports and sign-out

- [ ] REPORT-000 · Research check
  Check ICCR and CAP datasets for sentinel lymph node reporting and IHE PaLM APSR structure, and confirm the template engine and PDF choice (STACK-035).
  Done when an ADR names the dataset version used.

- [ ] REPORT-001 · Report model and API
  Report per case with template id and version, field values with source (manual, measurement, AI confirmed), status draft, signed, amended, and signer.
  Done when API tests cover the lifecycle and audit entries.

- [ ] REPORT-002 · Template engine
  Templates as versioned data, with fields, types, conditional visibility, validation and computed fields. Lab admins can enable templates per specimen type.
  Done when unit tests evaluate conditions and computed fields.

- [ ] REPORT-003 · Sentinel lymph node template
  Specimen, nodes examined, nodes with tumor, largest deposit, category, extranodal extension, AI used.
  Done when tests fill the template from seeded findings and the category is computed from the largest deposit.
  Refs mock §2.19.

- [ ] REPORT-004 · Prefill from confirmed findings
  Fields fill only from what the doctor confirmed, never from raw AI output, and each AI-derived value names its source.
  Done when tests confirm unconfirmed AI areas never reach the report.

- [ ] REPORT-005 · Report tab and editor
  Field editing, sources shown, validation messages, "open sign-out".
  Done when component tests cover editing and validation.

- [ ] REPORT-006 · Before-signing checklist
  All AI areas looked at, at 10× or more, tissue viewed percentage, uncertain cells checked and verdict settled, open threads as a warning. Incomplete items link to "go to unseen tissue".
  Done when unit tests compute the checklist from coverage and review data and E2E follows a "go to unseen" link.

- [ ] REPORT-007 · AI disclosure
  Exact model names and versions for every model whose output influenced a confirmed value, plus validation status.
  Done when tests check the disclosure against the job records.

- [ ] REPORT-008 · Sign-out
  Cmd+Enter or the top-bar button, re-authentication per SEC-023, the case moves to signed, a transition back to the worklist.
  Done when E2E signs out by keyboard and the audit log and e-signature record exist.

- [ ] REPORT-009 · PDF rendering
  Header, patient banner, fields, signature block (setting), AI disclosure, page numbers.
  Done when a golden PDF test compares text content and layout fingerprints.
  Depends on STACK-035.

- [ ] REPORT-010 · Amendments and addenda
  After sign-out, changes create an amendment with reason, new signature and a visible history.
  Done when tests confirm the original stays immutable and the amendment chain renders.

- [ ] REPORT-011 · "No tumor seen" variant
  For cases with no flagged area that went through a systematic scan.
  Done when tests require coverage above the lab threshold before this variant can be signed.

- [ ] REPORT-012 · Report attachments
  Review CSV, measurement list and selected snapshots attached to the report.
  Done when tests confirm attachments are generated and stored with the report.

- [ ] REPORT-013 · Report delivery hook
  Signed reports are published through the LIS adapter interface (CASES-010) and available as FHIR DiagnosticReport.
  Done when a contract test validates the FHIR resource.

---

## 20 CASES · Patients, cases, import and LIS adapter

- [ ] CASES-000 · Research check
  Done when STACK-040 is confirmed and the case data model is written as an ADR.

- [ ] CASES-001 · Patient and case model
  Patient (name, sex, birth date or age, MRN, encrypted per SEC-004), case (accession, priority, due, specimen, clinical note, clinical question, assignee, folder, status), specimen, block, slide.
  Done when migrations, API tests and isolation tests pass.

- [ ] CASES-002 · Case creation UI
  Create a case with patient lookup or creation, specimen and blocks, then upload slides.
  Done when E2E creates a case and uploads a slide.

- [ ] CASES-003 · Folders and spaces
  Folders by service with colours, membership, counts.
  Done when API and component tests cover folders.

- [ ] CASES-004 · Accession number rules
  Per-tenant format and uniqueness.
  Done when tests cover format validation and collisions.

- [ ] CASES-005 · Patient history
  Earlier cases and reports for a patient across years.
  Done when E2E opens a historic report from the patient view.

- [ ] CASES-006 · CSV import
  Patients, cases and slide manifests with a dry run, validation report and idempotent re-run.
  Done when tests import a 500-row file twice without duplicates.

- [ ] CASES-007 · FHIR import
  Patient, ServiceRequest and Specimen bundles mapped to our model.
  Done when contract tests import sample bundles.

- [ ] CASES-008 · LIS adapter interface
  A documented adapter interface for intake (orders) and output (reports), with a no-op adapter and a file-drop adapter for the pilot.
  Done when tests run the file-drop adapter end to end.

- [ ] CASES-009 · Search API
  Patients, cases, slides, reports, folders, with scopes, tenant-scoped, PHI-safe ranking.
  Done when tests meet the STACK-034 latency on seeded data.

- [ ] CASES-010 · Report output through the adapter
  Done when a signed report reaches the file-drop adapter as FHIR and PDF.
  Depends on REPORT-013.

- [ ] CASES-011 · Case assignment and routing rules
  Assign by folder, specimen and load, STAT first.
  Done when unit tests cover routing rules.

---

## 21 AIP · AI platform: registry, tiers, jobs, GPU pool

- [ ] AIP-000 · Research check
  Re-check doc 20's ranked list against the current literature (nucleus segmentation and typing models, pathology foundation models, promptable segmentation) and confirm STACK-022, STACK-027 and STACK-031.
  Done when an ADR lists the v1 model line-up per tier and its licence status.

- [ ] AIP-001 · Model artifact storage
  Versioned, immutable model artifacts (PyTorch, ONNX, quantised variants, calibration files) with checksums.
  Done when tests reject an artifact whose checksum does not match.

- [ ] AIP-002 · Model registry
  Model family, task (tumor map, detector, typer, interactive encoder, decoder), version, licence of weights and data, allowed tenant types, input microns per pixel, calibration temperature, evaluation report link, status (candidate, validated, retired).
  Done when API tests cover registration and the licence rule from STACK-031 blocks a non-commercial model in a commercial tenant.

- [ ] AIP-003 · Tiers Best, Good, Fast
  Tier mapping per task and per site, set by the lab, with the exact model visible on hover.
  Done when API and component tests cover mapping and hover details.
  Refs mock §2.14, kit decision D5.

- [ ] AIP-004 · Model tier picker
  The picker dialog in Annotate and the tier chip in Review.
  Done when component tests match mock 9 "choosing a model".

- [ ] AIP-005 · Validation mapping per site and specimen
  Which models are validated for which specimen types at which site. An unvalidated combination drives the "not validated" state.
  Done when API tests cover the mapping and the case shows the right state.
  Depends on MLEVAL-008.

- [ ] AIP-006 · GPU worker pool
  Modal GPU functions per model family with GPU type, memory caps, concurrency and container limits, scaling to zero when idle ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when tests confirm the limits and that containers scale with queue depth in staging.
  Refs docs 17, 19.

- [ ] AIP-007 · Interactive priority gate
  Interactive requests (embeddings, region passes) run in their own Modal function, pre-warmed when a slow device activates the tool, so they never queue behind job tiles ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when a load test meets STACK-027's target while a whole-slide job runs.

- [ ] AIP-008 · Job model and API
  Jobs per slide and task with scope (view, selection, slide), parameters (detector, typer, test-time augmentation, ordering), state, progress per stage, cancel, resume, retry.
  Done when API tests cover the lifecycle and permissions.

- [ ] AIP-009 · Resumable whole-slide jobs
  Tissue-masked core tiles with context halo, centroid ownership, tumour-first ordering, chunk per tile, resume by skipping tiles already written.
  Done when a test kills a job halfway and the resumed run produces the same chunks as an uninterrupted run.
  Refs doc 19, [`poc/server/app/nuclei/wsi.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/app/nuclei/wsi.py).

- [ ] AIP-010 · Pre-read on arrival
  When a slide is published, the pipeline runs tissue, tumor map, then cells, in priority order with STAT first. Pause queue and run STAT first controls. Held jobs await a decision when no validated model applies.
  Done when E2E uploads a slide and the worklist AI cell goes from queued to ready.

- [ ] AIP-011 · Job progress streaming
  Per-stage progress and partial results stream to the case view and the worklist.
  Done when tests confirm partial areas arrive before job completion.

- [ ] AIP-012 · Patch service on the server
  Read patches at a requested microns per pixel from any supported format, with LRU caching and sparse-region awareness.
  Done when tests read the same 128 µm patch from SVS, NDPI and OME-Zarr fixtures and compare pixels.
  Refs docs 10, 11, 15.

- [ ] AIP-013 · Result chunk store
  Typed-array chunks per job tile in object storage (offsets, level-0 vertices, class, scores, type probabilities, alternative types, flags), with a summary index.
  Done when unit tests round-trip chunks and the schema is versioned.
  Depends on STACK-021.

- [ ] AIP-014 · AI cost and usage metering
  GPU seconds per tenant, job and model.
  Done when tests confirm metering records and a usage report per tenant.

- [ ] AIP-015 · Model serving health in the UI
  Never show an AI provider as active when it is offline. Show a clear state instead.
  Done when tests simulate a worker outage and the UI shows unavailable states.
  Refs doc 25.

---

## 22 AISEG · Interactive segmentation

- [ ] AISEG-000 · Research check
  Compare PathoSAM (and its AIS decoder), newer SAM variants, small SAMs fine-tuned on pathology (EfficientViT-SAM, EdgeSAM, MobileSAM) and exemplar prompting (SAM 3) on the held-out sets.
  Done when an ADR picks encoder and decoder per tier, backed by MLEVAL numbers.

- [ ] AISEG-001 · ONNX export pipeline
  Export encoder, decoder, batch decoder and AIS decoder, with the square `orig_im_size` trace and verification against PyTorch.
  Done when the verification test reports IoU 1.0 for fp32 and at least 0.96 for quantised graphs.
  Refs [`poc/server/tools/export_pathosam_onnx.py`](https://github.com/fedasevich/pathlogy-poc/blob/master/server/tools/export_pathosam_onnx.py), `verify_pathosam.py`, doc 12.

- [ ] AISEG-002 · Quantised variants per execution provider
  4-bit MatMulNBits for WebGPU, uint8 for WASM, fp16 attempt through onnxruntime transformers conversion.
  Done when the browser test measures encode and decode times per variant and records them.
  Refs doc 14.

- [ ] AISEG-003 · Browser model cache
  Cache Storage, persistent storage request, background revalidation with ETag, protobuf header check before caching, "loaded from cache" or "downloaded N MB" message.
  Done when tests cover first load, cached load and a corrupted cache entry.
  Refs docs 14, 15.

- [ ] AISEG-004 · Inference worker
  Sequential session creation, provider choice by adapter request, inputs driven by graph metadata, serialised prompts that drop stale answers.
  Done when tests confirm stale answers are dropped and two sessions never initialise concurrently.
  Refs doc 14.

- [ ] AISEG-005 · Smart select tool
  Click is a positive point, Shift+click extends, right-click or Alt+click is a negative point, drag is a box prompt, Backspace removes the last point, Enter accepts, Esc discards. The best of the candidate masks is chosen, never derived boxes.
  Done when interaction tests cover each gesture and an accuracy smoke test on fixtures meets the MLEVAL baseline.
  Refs docs 13, 14, 20 §2.7.

- [ ] AISEG-006 · Hover preview
  Dashed outline about 60 ms after the pointer rests, one request in flight, latest position only, cached by prompt, only when the embedding is cached. Can be turned off.
  Done when a manual measurement on the owner's Mac, recorded as a result file, shows pointer-to-outline latency under 100 ms ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Refs doc 15.

- [ ] AISEG-007 · Embedding prewarm
  Encode the view after 350 ms of camera stillness, embedding LRU of 6, pause while moving.
  Done when tests confirm the first click on a prewarmed view is under 150 ms.
  Refs doc 14.

- [ ] AISEG-008 · Server embedding service
  The server encodes with the larger encoder and returns a float16 embedding per tile, cached over the tissue mask. The browser runs only the decoder.
  Done when tests confirm the browser uses server embeddings when present and falls back to local encoding.
  Refs doc 20 §2.10.

- [ ] AISEG-009 · Embedding window crop for decoder speed
  Crop the embedding around the prompt before decoding.
  Done when the decoder time drops below the POC's 40 ms floor in the browser test, or an ADR records why not.
  Refs doc 20 §2.10.

- [ ] AISEG-010 · Auto region tool
  Drag a region, the AIS decoder segments every nucleus per tile with watershed and sub-pixel contours. A click does the patch under the cursor. Detect-in-selection runs on one closed shape.
  Done when a test on the TNBC fixture meets the MLEVAL PQ baseline and the region pass finishes under the budget in TEST-006.
  Refs doc 26.

- [ ] AISEG-011 · Sub-pixel contour tracing
  Done when unit tests show traced outlines cover at least 98% of mask area at 20× (pixel-centre rings covered 80%).
  Refs doc 26.

- [ ] AISEG-012 · Scale presets
  Nuclei 0.25 µm, cells, tissue, region, mapped to model input microns per pixel.
  Done when tests confirm patches are read at the right level for each preset.

- [ ] AISEG-013 · Fast tier in the browser without a GPU
  A small instance model (InstanSeg or StarDist exported to ONNX) as the default auto tool when WebGPU is missing.
  Done when the WASM path segments a 512 px tile in under 1 s on the CI CPU runner, or an ADR defers it.
  Refs doc 20 §2.4.

- [ ] AISEG-014 · Find more like these (exemplar prompting)
  Spike only: select a few cells and find similar objects in the view.
  Done when an ADR records feasibility and quality, with a go or no-go.
  Refs doc 20 §2.9.

---

## 23 AINUC · Whole-slide nuclei, typing and confidence

- [ ] AINUC-000 · Research check
  Pick the detector and typer per tier from current models (PathoSAM AIS, HoVer-NeXt, CellViT++, NuLite, InstanSeg) under the STACK-031 licence policy.
  Done when an ADR names them with MLEVAL numbers.

- [ ] AINUC-001 · Detector runner
  Tile, infer at the model's microns per pixel, trace instances, write chunks. Must not recreate the POC's quadratic post-processing.
  Done when a test on a fixed region matches the reference output and a throughput test records seconds per mm².
  Refs docs 17, 19, 26.

- [ ] AINUC-002 · Typer runner
  Per-nucleus class probabilities and alternative types, with a per-slide tissue default for ambiguous mappings (epithelial is not always tumour).
  Done when tests confirm probabilities sum to 1 and the tissue default applies.
  Refs doc 21.

- [ ] AINUC-003 · Chunk schema with probabilities
  Every chunk carries type probabilities and flags so confidence features work on paged results.
  Done when a schema test fails if probabilities are missing.
  Refs docs 31, 33.

- [ ] AINUC-004 · Summary points API
  Per nucleus centroid, size, class, score, type probabilities and flags, without outlines.
  Done when a test fetches the summary for 1.6M nuclei under 25 MB.
  Refs doc 31.

- [ ] AINUC-005 · Chunk paging in the client
  Keep the summary, LRU of full chunks under a vertex budget, fetch the view plus margin nearest first, page automatically above 200k nuclei, keep deletions and promotions stable across eviction.
  Done when the doc 31 scenario (1.6M nuclei) is usable in under 4 s at under 100 MB heap in the perf suite.
  Refs [`poc/src/segment/paged-result.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/paged-result.ts), [`poc/src/app/paged-loader.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/paged-loader.ts).

- [ ] AINUC-006 · Calibration
  Temperature scaling per typer and test-time augmentation setting, fitted on a separate split, stored in the registry, never vector scaling.
  Done when MLEVAL reports ECE under 0.05 for the active typer.
  Refs docs 28, 29.

- [ ] AINUC-007 · Confidence bands
  Confident, likely, unsure, doubtful thresholds per typer from calibration data.
  Done when unit tests reproduce the band accuracies reported by MLEVAL.

- [ ] AINUC-008 · "May not be a nucleus" flag
  From the detector's score and the typer's foreground probability.
  Done when unit tests cover the rule and the review gallery shows the X action on flagged tiles.
  Refs doc 29.

- [ ] AINUC-009 · Area extraction from cells
  Group typed cells into areas for verdicts where no tumor map exists.
  Done when tests produce stable areas on a fixture.

- [ ] AINUC-010 · Whole-slide nuclei job UI
  Scope view, selection or slide. Defaults fixed for doctors, options for annotators. Find nuclei, cancel, load last run.
  Done when E2E starts, cancels and reloads a job.

- [ ] AINUC-011 · Throughput target
  Done when the job processes a CAMELYON16 slide on the chosen GPU in under one hour (POC laptop estimate: ten hours), recorded in a result file from an on-demand run ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Refs doc 20 §2.5.

---

## 24 AITUM · Tumor and region maps

- [ ] AITUM-000 · Research check
  Compare the MONAI CAMELYON ResNet18 bundle with foundation-model linear probes (UNI2, Virchow2, H-optimus, Prov-GigaPath) on CAMELYON16 test slides, under the licence policy.
  Done when an ADR picks the v1 tumor model and lists the evaluation.
  Refs doc 20 §2.6.

- [ ] AITUM-001 · Tumor map job
  Fully convolutional inference over the tissue mask, probability grid stored as a raster pyramid.
  Done when a CAMELYON16 test slide scores within the expected FROC range in MLEVAL.

- [ ] AITUM-002 · Heatmap layer
  Colormaps (viridis, inferno, turbo), opacity, threshold, source chip naming the model.
  Done when golden tests cover colormaps and threshold.

- [ ] AITUM-003 · Areas from the tumor map
  Threshold, connected components, outlines, size across in mm, category.
  Done when tests on the reference slide produce areas matching the ground truth within tolerance.

- [ ] AITUM-004 · View-scoped map on demand
  Compute the map for the current view when no whole-slide map exists.
  Done when tests confirm the map extends as the user pans and asks again.

- [ ] AITUM-005 · Painted maps
  User-painted maps from the brush are stored, versioned and exportable.
  Done when tests round-trip a painted map.

- [ ] AITUM-006 · Heatmap persistence and export
  Done when tests export a heatmap as an image pyramid and re-import it.
  Refs doc 25.

---

## 25 AILEARN · Learning from corrections

- [ ] AILEARN-000 · Research check and data-use policy
  Decide whether one tenant's corrections may improve shared models (default: no, per-tenant only, unless a tenant opts in by contract). Re-check the CellViT++ frozen-backbone recipe.
  Done when an ADR records the policy and the method.

- [ ] AILEARN-001 · Correction capture
  Only reviewed decisions with reviewer identity are training data. Plain recolours outside review do not teach.
  Done when tests confirm which events become training examples.
  Refs doc 25.

- [ ] AILEARN-002 · Browser per-slide learner
  Softmax regression on pooled embedding features plus the typer's log-probabilities, retrained in a worker in milliseconds per correction, saved with the slide's annotation document.
  Done when a test on the doc 22 protocol improves same-image typing accuracy by at least 10 points after 200 corrections.
  Refs doc 22, [`poc/src/segment/type-learner.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/type-learner.ts).

- [ ] AILEARN-003 · Learner UI
  Shows when the learner is active and how many examples it has, with forget.
  Done when component tests cover the states.

- [ ] AILEARN-004 · Server training rounds per tenant
  Fine-tune the typer head from pretrained weights on the tenant's reviewed examples, versioned rounds with a latest pointer, rollback by pointer.
  Done when tests run a round on seeded data, promote it through MLEVAL and roll back.

- [ ] AILEARN-005 · Recalibration after each round
  Done when each promoted round has a fitted temperature and bands.

- [ ] AILEARN-006 · Held-out validation split from recent labels
  Done when tests confirm the split excludes training examples and is stable across rounds.

- [ ] AILEARN-007 · Measure corrections per hundred nuclei
  The product metric for the loop, reported per tenant over time.
  Done when the metric appears on the lab dashboard with seeded data.

---

## 26 MLEVAL · Evaluation harness and promotion gate

- [ ] MLEVAL-000 · Research check
  Confirm metrics and datasets (PQ, AJI, mIoU, NoC@85 and @90, ECE, FROC) and dataset licences.
  Done when an ADR lists the datasets and their allowed use.

- [ ] MLEVAL-001 · Dataset registry and loaders
  MoNuSeg and PanNuke as reference only (in PathoSAM's training set), TNBC, CryoNuSeg, NuInsSeg as held-out, Lizard as native 20×, CAMELYON16 test slides for tumor maps.
  Done when loaders pass checksum and sample tests.
  Refs docs 20, 26.

- [ ] MLEVAL-002 · Geometric scorer
  4× supersampled centre sampling, PQ, AJI, F1, per-organ and per-tissue breakdowns.
  Done when the scorer reproduces POC numbers on the same inputs.
  Refs [`poc/server/tools/score_*`](https://github.com/fedasevich/pathlogy-poc/tree/master/server/tools), doc 26.

- [ ] MLEVAL-003 · Interactive protocol
  Realistic clicks (centroid with jitter), loose boxes, refinement clicks, NoC@85 and NoC@90.
  Done when the harness reproduces doc 26's held-out click and box numbers within tolerance.

- [ ] MLEVAL-004 · Typing and calibration evaluation
  Accuracy, balanced accuracy, confusion matrix with viewer-class mapping, ECE and band accuracy.
  Done when the harness reproduces doc 29's HoVer-NeXt numbers on the same fold.

- [ ] MLEVAL-005 · Tumor map evaluation
  FROC and Dice on CAMELYON16 test slides.
  Done when the harness runs on at least three test slides on demand, before a tumor-map model is promoted ([ADR 0011](adr/0011-hosted-ci-only.md)).

- [ ] MLEVAL-006 · Promotion gate
  A model version is promoted to a tier only when it meets thresholds per task, with the evaluation report stored in the registry.
  Done when a test promotion fails on a degraded model and passes on the reference one.

- [ ] MLEVAL-007 · Browser parity tests
  Quantised browser graphs must match server outputs within tolerance.
  Done when CI compares ONNX outputs to PyTorch on a fixed patch set.

- [ ] MLEVAL-008 · Site validation reports
  Run a model on a site's local validation set and produce a report with sensitivity and specificity, which feeds AIP-005.
  Done when a test produces the report for seeded data and the announcement of a validation reaches the home feed.

- [ ] MLEVAL-009 · Evaluation dashboard
  Done when results from on-demand evaluation runs are published as a static report with trends ([ADR 0011](adr/0011-hosted-ci-only.md)).

---

## 27 SET · Settings

Scopes: personal (follows the user), this device (stays with the computer), set by the lab (shown, locked). The full list is in mock §2.15 and the kit settings table.

- [ ] SET-000 · Research check
  Done when the settings schema with scopes and defaults is written as an ADR from mock §2.15.

- [ ] SET-001 · Settings storage and resolution
  Server storage for personal and lab settings, device storage for device settings, resolution order lab locked, then personal, then device, then default. Typed schema shared by client and server.
  Done when unit tests cover resolution for every scope combination.

- [ ] SET-002 · Settings modal shell
  Left navigation, scope badges legend, live application behind the dimmed backdrop, closes with Esc, the close button or a backdrop click. Opens with Cmd+comma.
  Done when component tests cover navigation and closing.

- [ ] SET-003 · Display section
  Theme, slide brightness, density, patient names, lengths, magnification label, language (English only, shown disabled).
  Done when tests confirm each setting changes the UI live.

- [ ] SET-004 · Layout section
  Tools rail or dock with previews, side panel width and hide, panel while moving, minimap mode, slide tray.
  Done when tests cover each setting.

- [ ] SET-005 · AI and confidence section
  Wording with a live example, outline mode, model tiers per task, cutoff (lab, locked), inspector blocks (warnings, track record, calibration details).
  Done when tests cover each setting and the locked cutoff cannot be edited by a pathologist.

- [ ] SET-006 · Navigation and devices section
  Main device, wheel mode, double-click behaviour, speed per device, invert zoom, calibrate device.
  Done when tests cover each setting and per-device speed persistence.

- [ ] SET-007 · Shortcuts section
  Preset (viewer default, QuPath-like, Figma-like), most-used bindings with change, reset to defaults, see all.
  Done when tests rebind a key and the keycaps update everywhere.
  Depends on CMD-001.

- [ ] SET-008 · Notifications section
  AI finished, replies, STAT assigned, STAT sound.
  Done when tests confirm the preferences gate notifications.

- [ ] SET-009 · Privacy and session section
  Initials while sharing, lock after (lab), patient banner (lab), sign out other devices.
  Done when tests cover each setting.

- [ ] SET-010 · Account section
  Name, role (lab), workspace (lab), signature block for reports.
  Done when tests cover editing and locked fields.

- [ ] SET-011 · Lab admin settings console
  Lab-level values for cutoffs per specimen, lock times, banner, tiers, templates, classes.
  Done when permission tests restrict it to lab admins and changes are audited.

- [ ] SET-012 · Home and worklist variant choice
  Users can pick their home and worklist variant unless an experiment pins them.
  Done when tests cover the choice and the experiment pin.

---

## 28 CMD · Command palette and shortcuts

- [ ] CMD-000 · Research check
  Done when STACK-014 is confirmed.

- [ ] CMD-001 · Key registry
  Every action registered once with id, default keys per preset, scope (global, viewer, review, annotate, worklist), chords (G then n), hold versus tap (Z, 180 ms), and input-focus awareness.
  Done when unit tests cover chords, hold and tap, scope precedence and typing in inputs.

- [ ] CMD-002 · Command palette
  Cmd+K from everywhere, fuzzy search over actions, places (areas, cases) and settings, grouped results with keys shown, Enter runs the first, lab actions only in developer mode.
  Done when E2E finds and runs an action, a place and a setting.
  Refs mock 15.

- [ ] CMD-003 · Shortcut sheet
  `?` opens a searchable sheet with Navigate, Review and Tools columns and a source badge per key (clinical, Figma, QuPath, ours), generated from the registry.
  Done when a test confirms every registered action appears on the sheet.
  Refs mock 18.

- [ ] CMD-004 · Key conflict check
  CI fails when two actions in overlapping scopes share a key. Resolves the Shift+L conflict between arrow and compare unlink, and P between polygon and worklist preview by scope.
  Done when the check runs in CI and the known conflicts are resolved.

- [ ] CMD-005 · Presets
  Viewer default, QuPath-like, Figma-like. Presets change tool keys only, and review keys stay.
  Done when tests switch presets and assert bindings.

- [ ] CMD-006 · Rebinding UI
  Capture a new key, warn on conflicts, reset.
  Done when E2E rebinds J and the review HUD shows the new key.

---

## 29 DEV · Input devices and tablet layout

- [ ] DEV-000 · Research check
  Check Gamepad API and WebHID support across target browsers and the SpaceMouse HID report format.
  Done when an ADR lists support and fallbacks.

- [ ] DEV-001 · Input abstraction
  Devices produce semantic intents (pan vector, zoom delta, next cell, keep, set type, not a cell, next area, peek, preset step) consumed by the viewer and review loop.
  Done when unit tests cover the intent mapping for every device in the kit device matrix.

- [ ] DEV-002 · Trackpad detection and gestures
  Two-finger pan, pinch zoom, two-finger click for negative point, no drag-to-pan requirement.
  Done when replayed traces from macOS and Windows trackpads produce the right intents.

- [ ] DEV-003 · Gamepad support
  Left stick pans with speed by deflection, triggers zoom, shoulder buttons step presets, A keep, B next, X not a cell, D-pad set type, Start next area, hold Select for peek. Dead zones and per-device speed.
  Done when unit tests with a simulated gamepad cover each mapping.

- [ ] DEV-004 · SpaceMouse over WebHID
  Tilt pans, push and pull zoom, side buttons step presets or next cell and keep, full pull for peek, rotation off by default, permission prompt flow.
  Done when tests with recorded HID reports cover each mapping.

- [ ] DEV-005 · Device calibration
  Calibrate dead zones and speed.
  Done when tests confirm calibration values are stored per device.

- [ ] DEV-006 · Device legend on the canvas
  A card showing the current device's controls in the current context (read, review, annotate).
  Done when component tests render the legend for every device.
  Refs mock §2.13.

- [ ] DEV-007 · Footswitch mapping
  A footswitch sending a key maps to next cell.
  Done when a test confirms the default mapping.

- [ ] DEV-008 · Tablet layout
  Top bar with larger targets, floating dock with 56 px targets, inspector as a bottom sheet with peek, half and full heights, review buttons of 52 to 60 px.
  Done when visual tests at 1024×1366 match kit W8 and the mock tablet tab.

- [ ] DEV-009 · Pen and touch separation
  The pen draws with the active tool, the finger pans, palm rejection by pointer type, double tap on the pen switches to the last tool, side button erases.
  Done when Playwright pointer-type tests confirm a finger never draws in Annotate.

- [ ] DEV-010 · Bottom sheet interactions
  Drag between heights, swipe left for the next cell.
  Done when touch tests cover each gesture.

- [ ] DEV-011 · Touch targets audit
  Done when an automated check confirms targets of at least 24 px on desktop and 44 px on tablet layouts.

---

## 30 NOTIF · Notifications

- [ ] NOTIF-000 · Research check
  Done when STACK-036 is confirmed.

- [ ] NOTIF-001 · Notification service
  Events (AI finished, reply, mention, STAT assigned, second opinion requested, guest replied) to in-app, email and realtime channels by preference.
  Done when tests cover routing by preference and tenant isolation.

- [ ] NOTIF-002 · In-app notification centre and badges
  Done when component tests cover unread counts and mark as read.

- [ ] NOTIF-003 · STAT banner
  A banner on any screen when a STAT case is assigned, with an optional sound.
  Done when E2E assigns a STAT case and the banner appears in another session.

- [ ] NOTIF-004 · Email templates without PHI
  Done when tests confirm subjects and bodies contain no patient identifiers and link to the app.

- [ ] NOTIF-005 · Digest and quiet hours
  Done when tests cover batching and quiet hours.

---

## 32 EXP · Experiments, analytics and surveys

- [ ] EXP-000 · Research check
  Done when STACK-033 is confirmed and the event taxonomy is written as an ADR.

- [ ] EXP-001 · Feature flag service integration
  Flags evaluated server and client side, per tenant, role and user, with a kill switch.
  Done when tests cover targeting rules.

- [ ] EXP-002 · PHI-free event taxonomy
  Events for navigation, review decisions, tool use and task boundaries, with ids only.
  Done when a schema test rejects events with free text fields.

- [ ] EXP-003 · Home and worklist A/B experiments
  Assignment, exposure events, metrics (time to open the first case, cases per hour, preference).
  Done when tests confirm stable assignment and correct exposure logging.

- [ ] EXP-004 · Layout experiments
  Left rail against bottom dock, moving minimap against pinned (kit decisions D6 and D8).
  Done when the experiments are configured and the analysis query exists.

- [ ] EXP-005 · In-app SUS and SEQ surveys
  SEQ after defined tasks, SUS after a number of sessions, rate-limited and dismissible.
  Done when tests cover triggering and storage without PHI.

- [ ] EXP-006 · Task timing for KPIs
  Measure time per sign-out, per area and per cell reviewed, chrome coverage at runtime, and reading-time estimate accuracy.
  Done when a KPI dashboard shows seeded data against the kit targets.

- [ ] EXP-007 · Consent and opt-out
  Analytics opt-in or opt-out per tenant policy and per user.
  Done when tests confirm no events are sent after opt-out.

- [ ] EXP-008 · Moderated test support
  A study mode that loads public slides (CAMELYON16) with scripted tasks and records timing, for the usability plan in the kit.
  Done when the eight kit test tasks can run end to end in study mode.
  Refs kit Usability test plan, [`poc/study/`](https://github.com/fedasevich/pathlogy-poc/tree/master/study).

---

## 34 OPS · Infrastructure and operations

- [ ] OPS-000 · Research check
  Done when STACK-029, STACK-030 and STACK-032 are confirmed.

- [ ] OPS-001 · Base infrastructure as code
  OpenTofu for DNS, certificates, R2 buckets, the Neon project and the Zitadel project per environment. Workers, Durable Objects and Modal resources are defined in their own config ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when `tofu plan` is clean for staging and production and a policy check passes.

- [ ] OPS-002 · Deploy definitions
  Wrangler config for the edge Worker and Pages, Modal app definitions for the API, ingest and ML functions, and the deploy scripts CI runs ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when CI recreates staging from git alone.

- [ ] OPS-003 · Environments
  Local, a preview per pull request (Workers preview version, Modal environment, Neon branch, bucket prefix) with seeded data, staging from `main` and production from tags, scaling to zero wherever the platform allows ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when a pull request gets a working preview URL and closing it deletes its branch, environment and prefix.

- [ ] OPS-004 · Database operations
  Migrations in deploy, Neon's pooler, autovacuum tuning for annotation tables, a Neon read replica for reporting.
  Done when a load test with bulk annotation inserts keeps p95 API latency under budget.

- [ ] OPS-005 · Continuous deployment
  Main to staging automatically, tagged releases to production with approval, database migration safety checks, rollback.
  Done when a rollback drill on staging succeeds.

- [ ] OPS-006 · Observability stack
  Traces, metrics, logs, dashboards for API, workers, GPU, ingest, tiles, realtime, plus frontend real-user monitoring of viewer frame times. Export is on only in production, and staging switches it on through the override for these tests ([ADR 0005](adr/0005-external-sends-only-in-production.md)).
  Done when dashboards exist and a synthetic error appears in alerting.

- [ ] OPS-007 · Alerting and on-call
  SLOs for availability, tile latency, ingest time, pre-read time. Alerts routed to on-call. Fault-injection tests on staging switch export on through the override ([ADR 0005](adr/0005-external-sends-only-in-production.md)).
  Done when each SLO has an alert tested by fault injection.

- [ ] OPS-008 · Backups and disaster recovery
  Recovery point and time objectives, cross-region backup copies within the residency rules, a documented and rehearsed restore.
  Done when a DR drill restores staging from backups within the objective.
  Depends on SEC-014.

- [ ] OPS-009 · Storage lifecycle and cost controls
  Tiering for old slides, GPU scale to zero, budgets and alerts per environment.
  Done when cost dashboards exist and lifecycle rules are tested on staging.

- [ ] OPS-010 · Tenant provisioning automation
  Create a tenant with region, IdP organisation, buckets, keys and defaults in one command.
  Done when a test provisions and deprovisions a tenant on staging.

- [ ] OPS-011 · Status page and maintenance mode
  Done when maintenance mode shows a banner and blocks writes, tested on staging.

- [ ] OPS-012 · Load and soak testing
  Concurrent viewers, uploads and jobs at pilot scale times three.
  Done when a load test report meets the SLOs.
  Depends on TEST-010.

---

## 35 TEST · Test infrastructure

- [ ] TEST-000 · Research check
  Done when STACK-012 is confirmed and the test pyramid with ownership per level is written as an ADR.

- [ ] TEST-001 · Unit test setup for TS and Python
  Done when both run in CI with coverage reports and a minimum coverage gate per package.

- [ ] TEST-002 · API test harness
  Ephemeral database per test run, factories for tenants, users, cases and slides, authenticated clients per role.
  Done when a sample test uses every factory.

- [ ] TEST-003 · Tenant isolation test generator
  Automatically runs cross-tenant access against every endpoint and table.
  Done when adding an endpoint without tenant scoping fails CI.
  Depends on IAM-004.

- [ ] TEST-004 · E2E harness
  Playwright against a seeded stack, with auth helpers, the debug handle, and traces and video on failure.
  Done when the skeleton suite runs locally and in CI.

- [ ] TEST-005 · Golden-image rendering tests
  Rendered slide views compared against stored images with per-format tolerances, in headless Chromium with SwiftShader on hosted runners ([ADR 0011](adr/0011-hosted-ci-only.md)). Includes assertions that frames are not empty.
  Done when a golden test catches a deliberately swapped colour channel.
  Refs doc 23 (empty frames looked fast).

- [ ] TEST-006 · Performance budget suite
  Time to fitted image, time to sharp after a jump, frame p95 while panning, overlay GPU time at 81k and 1.6M nuclei, hover preview latency, bundle sizes. Budgets stored in a file with ADR links, runs at several RTTs through the latency proxy.
  Done when a regression of 20% on any CPU-side budget fails CI. Frame-rate and overlay GPU-time budgets are checked by manual runs recorded as result files ([ADR 0011](adr/0011-hosted-ci-only.md)).
  Depends on TILES-006.

- [ ] TEST-007 · Memory and leak suite
  Slide switches, renderer switches, workspace switches and long review sessions with heap snapshots.
  Done when the 20-slide test runs nightly on hosted runners with software rendering and a pass threshold.

- [ ] TEST-008 · Visual regression for UI
  Component stories in both themes and densities.
  Done when a visual diff blocks a pull request until approved.

- [ ] TEST-009 · Accessibility testing
  axe on every story and E2E page, keyboard-only E2E flows for review and sign-out.
  Done when an a11y violation fails CI.

- [ ] TEST-010 · Load test tooling
  k6 or Locust scenarios for API, tiles and realtime.
  Done when scenarios run against staging on demand.

- [ ] TEST-011 · Contract tests for the API client
  Done when the generated client is tested against recorded API responses and schema drift fails CI.

- [ ] TEST-012 · Fixture slide library in CI
  The OpenSlide corpus subset, CAMELYON16 tumor_009 and test slides, synthetic tiny slides, cached on runners.
  Done when every format reader test uses a cached fixture.
  Depends on FOUND-016.

- [ ] TEST-013 · Workflow and job tests
  The Postgres job runner tested with a fake clock and forced worker kills ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when ingest and pre-read workflows have restart tests.

- [ ] TEST-014 · Security tests in CI
  DAST baseline scan on preview environments, dependency and container scans.
  Done when a known vulnerable dependency fails CI.

- [ ] TEST-015 · Cross-browser matrix
  Chromium, Firefox and Safari (WebKit) for the viewer on WebGL2, with WebGPU routes on Chromium and wherever supported.
  Done when the nightly matrix runs and results are published.
  Refs doc 20 (Safari and Firefox WebGPU parity untested).

- [ ] TEST-016 · Test data hygiene
  No real PHI in any fixture, generated patient names marked as synthetic.
  Done when a scanner flags non-synthetic names in fixtures.

- [ ] TEST-017 · Flaky test management
  Quarantine with an issue link and an expiry date.
  Done when quarantined tests are reported weekly.

- [ ] TEST-018 · Self-hosted Mac GPU runner (dropped)
  Dropped by [ADR 0011](adr/0011-hosted-ci-only.md). No self-hosted runners are used.

---

## 36 PILOT · Documentation and pilot readiness

- [ ] PILOT-000 · Research check
  Done when the pilot scope (sites, users, slide volume, specimens) is written down with the lab.

- [ ] PILOT-001 · User help and onboarding
  In-app help, a guided first-run walkthrough based on the mock's ten-step tour, the shortcut sheet.
  Done when E2E completes the walkthrough.
  Refs mock guided walkthrough.

- [ ] PILOT-002 · Admin documentation
  Tenant setup, users, roles, templates, tiers, validation, retention.
  Done when the docs exist and a new admin sets up a test tenant from them alone.

- [ ] PILOT-003 · Operations runbooks
  Deploy, rollback, restore, incident, GPU capacity, stuck jobs, ingest failures.
  Done when each runbook is exercised once on staging.

- [ ] PILOT-004 · Pilot data onboarding
  Import historic cases and slides for the pilot site with the bulk import tool.
  Done when a dry run on staging imports the pilot sample.

- [ ] PILOT-005 · Moderated usability study
  Run the kit test plan with 3 to 5 pathologists in study mode. Close decisions D6 and D8 and the wording comprehension check.
  Done when the results are written up and follow-up tasks are added to this backlog.

- [ ] PILOT-006 · Release checklist
  Security sign-off, pen test closed, backups verified, SLOs green for two weeks, compliance packs complete.
  Done when every item is ticked for the pilot release.

- [ ] PILOT-007 · Feedback channel
  In-app feedback with screenshot (PHI-blurred) routed to the team.
  Done when tests confirm screenshots are blurred over slide and patient areas.

---

## Later epics (not in v1, kept for planning)

- DICOMweb reader and DICOM WSI ingest (doc 20 §3.4).
- MRXS, iSyntax (libisyntax to WASM), CZI and VSI readers.
- Watch-folder and scanner bucket sync agent.
- LIS integration over HL7 v2 and FHIR with a real LIS.
- Offline cases with a service worker cache.
- CRDT multiplayer annotation.
- IVDR, FDA and EU AI Act regulatory evidence packages.
- Full localisation (Czech first).
- Foundation-model features beyond tumor maps (tissue classification, search by similar region).
