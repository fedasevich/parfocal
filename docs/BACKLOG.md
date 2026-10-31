# Parfocal backlog

This file takes an empty repository to a production-quality, multi-tenant cloud platform where researchers evaluate AI results on whole slides and doctors review them. It covers whole-slide viewing, importing and running AI results, object IDs, review tasks with verdicts and opinions, disagreements and sign-off, the evaluation report, comments and annotation. Since 2026-10-17 it follows the AI results review direction ([ADR 0053](adr/0053-ai-results-review-direction.md)). The earlier hospital sign-out workflow is kept as ideas for consideration. Tasks are split by feature and sized so that one task is one pull request of about half a day to two days. Work them top to bottom inside a milestone, respecting the dependencies.

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
- `poc/` means `/Users/yuriifedas/WebstormProjects/poc/` locally or `https://github.com/fedasevich/pathlogy-poc/blob/master/` on GitHub, and code references are links. `doc NN` means `poc/docs/NN-*.md`, listed with full links in [project/poc-reference.md](project/poc-reference.md). `kit:` names a UX kit page or wireframe (W1 to W73). W39 to W73 and Flows 9 to 30 came from the gap review ([ADR 0023](adr/0023-gap-review-backend-first.md)), and the hi-fi mock has them as steps 23 to 35, from 23 Sign in and lock to 35 Empty and error states. `mock N` names step N of the converged mock tab, from 1 Home to 21 Shortcuts. Step 3 is Status board and step 4 Upload slides, so the case screens start at 5 Case at low power and 6 Area at 10x, and step 15 is Report and PDF ([ADR 0012](adr/0012-ux-round-2-prototype-revisions.md), [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md)).
- Tasks say what users must be able to do, the rules behind it and the tests that prove it. Layout, sizes, placement and wording follow the prototype at the time the task is built, so a later prototype change needs a backlog edit only when it changes behaviour or rules. `mock N` and `kit:` references point at the current design, not a fixed spec, and a test checks behaviour rather than a pixel layout unless the task says otherwise.
- Since [ADR 0053](adr/0053-ai-results-review-direction.md), `mock: id` names a screen of the hi-fi mock by its id, with a scene after a slash where it matters, as in `mock: guided/disagree`, `mock: upload/check` or `mock: job`. `kit:` also names the Parfocal kit pages such as `kit: ID system` or `kit: UI kit: tags, icons and type`. The POC docs that hold the new direction are doc 37 (decisions), doc 38 and doc 39 (feedback rounds), doc 40 (UI and UX audit), doc 41 (what is clickable, tags, icons and type) and doc 42 (round 5: upload by slide, the magnification chip, slide loading, verdict notes, passkeys and storage).
- Epics with the milestone Idea and tasks whose title starts with `Idea:` are kept from the hospital direction ([ADR 0053](adr/0053-ai-results-review-direction.md)). They are not planned. Don't start one unless the owner asks, and never make a planned task depend on one. A task that is needed again loses its `Idea:` prefix in a backlog edit with an ADR.
- Tasks from the gap review ([ADR 0023](adr/0023-gap-review-backend-first.md)) are backend first: models, rules, APIs, events and their tests. The screens for them are still changing in the prototype, so their UI tasks are added only when those screens settle, and no backend task here may depend on a layout.
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
| Product direction | AI results review: researchers import or run AI and evaluate it, doctors review, fix, comment and give an opinion. The viewer stays. The hospital sign-out workflow is kept as ideas ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Roles | Researcher and reviewer in a workspace, with admin rights as a switch on a researcher that opens the admin page and adds no data access. Owner, reviewer and viewer in a project. They replace the six hospital roles of [ADR 0026](adr/0026-roles-and-permission-matrix.md) and the admin role of [ADR 0061](adr/0061-researcher-reviewer-and-admin-roles.md) (IAM-022, IAM-024, [ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md)) |
| Data model | Project, then an optional case, then slide, then result sets. Loose slides sit directly in a project. Every import or model run is a result set with its model, version, date and source, and reviewer edits form a separate reviewed layer ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Privacy | Each project is de-identified (the default, no patient fields, names stripped on upload) or clinical (patient fields optional, names can be hidden, access logged) ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Object IDs | Short IDs per slide (T2, T2·C145, C3021, R4, Z1, M1), a full path for links and exports (`P07/S26-04812/A1/T2·C145`), carried across result sets by overlap ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Reports | The evaluation report is an ordered list of blocks from a fixed catalogue. Study templates (detection, segmentation, cell typing, reader study, sentinel node) preset a review task and its report, live in the admin page's library, and one task's report can be rearranged ([ADR 0097](adr/0097-report-templates-built-from-blocks.md)) |
| Review | Review tasks with slides, a result set, reviewers, a split, a scope, an opinion form, blinding and a due date. Verdicts are Agree, Disagree or Not sure per object, in guided review or the full viewer. Disagreements go to a queue, and sign-off is a soft lock ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Interaction | A control responds only when clicking it changes something in the flow. Auto-advancing and far-reaching actions show an Undo. The bell is the only place for mentions, replies, tasks and jobs (doc 41, [ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Pilot data | Public slide datasets and their AI results in de-identified projects. Clinical projects use seeded fake patient identities. No real PHI until the triggers in [ADR 0003](adr/0003-pilot-platform-architecture.md) are met |
| Compliance | GDPR, HIPAA and ISO 27001 readiness in v1: audit log, encryption, residency, retention and erasure, BAA-ready logging, pen test |
| Repository | Monorepo `/Users/yuriifedas/WebstormProjects/parfocal` (GitHub `fedasevich/parfocal`) with `apps/web`, `apps/api`, `workers/*`, `packages/*` |
| Frontend | React with TypeScript. Every other library is a STACK decision |
| Backend | Python. Framework and every other library are STACK decisions |
| Renderer | Viv is the primary renderer and must work perfectly. The custom WebGPU engine and deck.gl 9.4 WebGPU stay as alternates behind one renderer interface, switchable only in the developer drawer |
| Formats | Read every format the POC could read, natively, with no conversion by default. Convert only when a format is unreadable or fails its performance budget. Sidecar indexes and derived low-resolution levels are allowed because they do not change the original |
| Ingest | Resumable browser upload of slides together with their AI result files, server-side import from an HTTPS or object-storage link, reading in place from a connected source, a webhook per project and a watched bucket, all with server validation and indexing ([ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md), [ADR 0053](adr/0053-ai-results-review-direction.md)). DICOMweb, SFTP and scanner shares are later epics, and LIS intake is an idea |
| Identity | OIDC through a managed or self-hosted identity provider. Organisations, roles and invitations live in our database. Per-organisation SAML or OIDC SSO is a later task |
| AI runtime | Hybrid. Batch work (pre-read, whole-slide nuclei, tumor maps, training) runs on server GPU workers. Interactive segmentation runs in the browser through ONNX, using server-computed embeddings when they exist |
| AI scope v1 | Importing AI results made elsewhere is first class. Built-in models (tumor map, nuclei detection and typing) and a lab's own HTTP endpoint run on demand as model runs that make result sets. Interactive segmentation and learning from corrections stay. Nothing runs on arrival by default ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Model licensing | On hold (STACK-031). The owner said on 2026-10-15 that Parfocal will not really be commercial. HoVer-NeXt and VISTA-2D weights are CC BY-NC-SA. PanNuke-derived calibration needs review. The model registry stores licence metadata from day one |
| ML evaluation | The POC harness is ported as the MLEVAL epic and gates promotion of any model to a tier |
| UX variants | The launchpad is the home for everyone. My work replaces the worklist with To review, Assigned by me and All slides. The department dashboard, the worklist views and the status board are ideas. Choices still open ship behind feature flags ([ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md), [ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Devices | Mouse, keyboard, trackpad, tablet with pen, gamepad (Gamepad API), SpaceMouse (WebHID) |
| Collaboration | Realtime threads pinned to an object ID, an ROI or a point, with mentions and blinding, presence and follow-my-view. Guest consultant links are an idea. No CRDT multiplayer annotation in v1 ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Cases and reports | Cases are optional groups of slides inside a project, created by hand or from file names on upload, with CSV import. The v1 output is the evaluation report per review task with PDF, CSV, JSON and GeoJSON exports. Synoptic sign-out reports ([ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md)), FHIR import and the LIS adapter are ideas ([ADR 0053](adr/0053-ai-results-review-direction.md)) |
| Language | English only, with every string externalised (i18n-ready) |
| Offline | No offline mode. The Fast tier runs in the browser. Edits are optimistic and retried on flaky networks |
| UX research | Feature flags, experiments, PHI-free opt-in analytics, in-app SUS and SEQ, task timing for the KPIs |
| Sequencing | Walking skeleton first (M1), then feature epics deepen it |
| Testing | Everything is tested. The TEST epic builds the infrastructure, and every task's "Done when" names its tests |
| Design system | Zones by background, one component per job, avatar plus name for people, nine tag types, five icon sizes (12, 16, 20, 24, 40), nine type sizes (11, 12, 13, 14, 16, 18, 20, 24, 28) with running text never under 12 px (doc 38, doc 39, doc 41, kit: UI kit: tags, icons and type) |

## Product KPIs carried from the UX kit

- Chrome covers under 35% of a 1440×900 screen in Review (POC today: 48.5%, 67% with the one-click tool).
- Core review tasks (judge the objects of a slide, comment on one, submit the opinion) take 30% less time than in the POC viewer in a moderated test.
- A reviewer new to Parfocal finishes a first slide in guided review without help. TODO: set the time target after the first moderated session.
- SUS above 70 with 3 to 5 pathologists and 2 or 3 researchers.
- Viewer stays at 60 fps while panning with 1.6M nuclei loaded (POC: under 5 ms GPU per frame with LOD, culling and paging, doc 31).

## Source map

| Area | Primary spec | Supporting POC material |
| --- | --- | --- |
| Every existing action and key | doc 34 | [`poc/src/app/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/app), [`poc/src/annotations/editor.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/annotations/editor.ts) |
| Screens, layout, principles | doc 35, kit IA and wireframes, mock 1 to 21 | doc 25 (UX review), doc 30 (Esc ladder) |
| Settings, devices, shortcuts | kit Interaction spec, mock 19 and 21, mock §2.13 device legend | doc 16 (mouse pass) |
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
| AI results review direction | doc 37, doc 38, doc 39, doc 40, doc 41, [ADR 0053](adr/0053-ai-results-review-direction.md) | kit Parfocal pages, mock screens home, worklist, project, upload, runmodel, job, task, guided, opinion, disagree, signoff, evaluation, admin, setup |
| Platform architecture research | [`poc/docs/presentation1`](https://github.com/fedasevich/pathlogy-poc/tree/master/docs/presentation1), [`poc/docs/presentation2`](https://github.com/fedasevich/pathlogy-poc/tree/master/docs/presentation2) | Cytomine, EXACT, Concentriq, QuPath, V7 reports |

## Milestones

| Milestone | Meaning | Gate |
| --- | --- | --- |
| M0 Stack decided | Every STACK task closed with an ADR | `docs/adr/` holds one ADR per slot |
| M1 Walking skeleton | Log in, create a project, upload one SVS with a result file, open it in Viv, draw a polygon, give one verdict and submit the review, all on staging | SKEL epic done, E2E green on staging |
| M2 Viewer parity | Every POC format opens correctly in Viv with POC-level performance, plus alternates behind the interface | VIEW, TILES, INGEST done, perf and golden suites green |
| M3 Review loop | Projects, upload with AI results, object IDs, review tasks, My work, guided review and the slide view with verdicts and the opinion form, navigation aids, measurement, settings, palette, sign-up and setup | ADAPT, PROJ, RSET, OBJ, TASK, GUIDE, WL, CASE, NAV, REVIEW, MEAS, SET, CMD, ONB done |
| M4 AI runs and visualization | Model runs and the jobs tray, lab model endpoints, layers, heatmaps, diff and the object table, interactive AI in Annotate | AIP, JOBS, VIZ, AISEG, AINUC, AITUM, MLEVAL core done |
| M5 Collaboration and evaluation | Threads pinned to IDs, presence, compare, notifications, the disagreement queue and sign-off, the evaluation report, remote sources and webhooks, the admin page | COLLAB, CMP, NOTIF, ADJ, EVAL, REMOTE, ADMIN, CASES done |
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
| 10 | HOME | Home | M3 |
| 11 | WL | My work | M3 |
| 12 | CASE | Slide view | M3 |
| 13 | NAV | Navigation aids | M3 |
| 14 | REVIEW | Review workspace | M3 to M4 |
| 15 | ANN | Annotate workspace | M2 to M4 |
| 16 | MEAS | Measurements | M3 |
| 17 | COLLAB | Comments and realtime | M5 |
| 18 | CMP | Compare slides | M5 |
| 19 | REPORT | Clinical reports and sign-out | Idea |
| 20 | CASES | Cases and patients | M3 to M5 |
| 21 | AIP | AI platform, registry, jobs, GPU pool | M4 |
| 22 | AISEG | Interactive segmentation | M4 |
| 23 | AINUC | Whole-slide nuclei, typing, confidence | M4 |
| 24 | AITUM | Tumor and region maps | M4 |
| 25 | AILEARN | Learning from corrections | M6 |
| 26 | MLEVAL | Evaluation harness and promotion gate | M4 |
| 27 | SET | Settings | M3 |
| 28 | CMD | Command palette and shortcuts | M3 |
| 29 | DEV | Input devices and tablet layout | M6 |
| 30 | NOTIF | Notifications | M3 to M5 |
| 31 | LAB | Developer drawer and HUD | M2 |
| 32 | EXP | Experiments, analytics, surveys | M3 to M6 |
| 33 | I18N | Internationalisation readiness | M1 |
| 34 | OPS | Infrastructure and operations | M1 to M6 |
| 35 | TEST | Test infrastructure | M0 to M6 |
| 36 | PILOT | Documentation and pilot readiness | M6 |
| 37 | BOARD | Status board, tickets and lab work | Idea |
| 38 | TEAM | Team, capacity, absences and hand-over | Idea |
| 39 | TB | Tumor boards | Idea |
| 40 | PROJ | Projects, privacy modes, class taxonomy and templates | M3 |
| 41 | RSET | Result sets and AI result import | M3 |
| 42 | OBJ | Object IDs | M3 |
| 43 | TASK | Review tasks and the slide pipeline | M3 |
| 44 | GUIDE | Verdicts, guided review and the opinion form | M3 |
| 45 | ADJ | Disagreements, adjudication and sign-off | M5 |
| 46 | EVAL | Evaluation report, study templates and exports | M5 |
| 47 | JOBS | Model runs, the jobs tray and lab models | M4 |
| 48 | REMOTE | Remote sources, webhooks and events | M5 |
| 49 | ONB | Sign-up, setup and the sample project | M3 |
| 50 | ADMIN | Admin page | M5 |
| 51 | VIZ | Layers and visualization | M4 |
| 52 | ADAPT | Reverting or reworking the built hospital code | M3 |

---

## 00 STACK · Stack decisions with SOTA candidates

Each task compares the listed candidates against the stated criteria, re-checks that they are still current (versions, maintenance, licence, security record), and ends with an ADR in `docs/adr/`. The default is the recommendation at the time of writing (October 2026). Keep it unless the check finds a reason not to. Where a spike is named, build the smallest throwaway prototype that answers the question and record its numbers in the ADR.

Cross-cutting criteria for every slot: maturity and maintenance, typed APIs, testability, licence compatible with commercial SaaS, EU hosting options, HIPAA BAA availability for managed services, and fit with the other choices.

### Frontend

- [x] STACK-001 · Build tool and dev server
  Candidates: Vite (Rolldown-based), Rsbuild, Next.js in SPA mode. Default: Vite, because the viewer is a client-heavy SPA with workers and WASM, and the POC already runs on Vite 8.
  Done when an ADR records the choice, worker and WASM bundling are confirmed with a spike that loads an ONNX model and a module worker under COOP and COEP.
  Refs doc 14 (COOP/COEP), [`poc/vite.config.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/vite.config.ts). Decided in [ADR 0015](adr/0015-vite-build-tool.md): Vite 8, with plain `server.headers` and `wasmPaths` for onnxruntime-web.

- [x] STACK-002 · React version and rendering mode
  Candidates: React 19 SPA with client rendering, React 19 with a server framework (Next.js, React Router framework mode). Default: React 19 SPA, with React Compiler evaluated. Server rendering brings little because every screen is authenticated and canvas-heavy.
  Done when the ADR records the React version, whether React Compiler is on, and the StrictMode policy for the viewer canvas.
  Decided in [ADR 0016](adr/0016-react-19-spa-compiler-strictmode.md): React 19.3 SPA, React Compiler on, StrictMode on with a viewer host that fully destroys its engine.

- [x] STACK-003 · Routing
  Candidates: TanStack Router, React Router 7 (library mode). Default: TanStack Router for fully typed routes and search params. That matters because worklist filters, case view state and deep links to a view all live in the URL.
  Done when a spike shows typed search params for `/case/:caseId/slide/:slideId?x=&y=&z=` with validation and a code-split route.
  Decided in [ADR 0048](adr/0048-routing.md): TanStack Router with Zod search params.

- [x] STACK-004 · Server state and data fetching
  Candidates: TanStack Query v5, RTK Query, SWR. Default: TanStack Query, with the generated API client (STACK-008) supplying query functions and keys.
  Done when the ADR covers caching, invalidation from realtime events (STACK-024), optimistic updates with retry for annotation edits, and suspense usage.
  Decided in [ADR 0049](adr/0049-server-state-and-data-fetching.md): TanStack Query v5 on the generated client, with invalidation from realtime events.

- [ ] STACK-005 · Client UI state
  Candidates: Zustand, Jotai, Redux Toolkit, XState for the complex state machines. Default: Zustand for app UI state (panels, tools, workspace, selection), and XState only where a real state machine helps (smart minimap, review loop, one-click prompt flow).
  Done when the ADR defines which state lives where: server state in Query, UI state in Zustand, URL state in the router, and viewer hot state outside React (STACK-006).

- [x] STACK-006 · Viewer hot-path state outside React
  Candidates: a plain observable store read with `useSyncExternalStore`, signals (Preact signals or TC39 signals polyfill), Zustand vanilla stores. Default: a framework-free viewer engine package that owns camera, tiles, overlays and workers, exposing a small subscribe API consumed through `useSyncExternalStore`. React must never re-render on camera frames.
  Done when a spike pans a Viv slide at 60 fps while a React inspector shows the zoom level, with zero React renders per frame, measured with the React profiler.
  Refs doc 24 (main-thread costs), doc 30 (code layout).

- [ ] STACK-007 · Component primitives and styling
  Candidates: React Aria Components, Radix Primitives, Ark UI. Styling: CSS Modules plus CSS custom properties, Tailwind CSS v4 with tokens, vanilla-extract, Panda CSS. Default: React Aria Components for accessible behaviour, and CSS Modules over design tokens as CSS variables. That keeps the kit's token set (dark and light) authoritative.
  Done when the ADR lists the primitive set mapped to kit components (button, segmented control, toggle, popover, dialog, menu, tabs, slider, listbox, tooltip) and confirms axe-clean output.

- [x] STACK-008 · API contract and client generation
  Candidates: OpenAPI 3.1 from the backend with Hey API (openapi-ts) or Orval to generate a typed client and Query hooks, tRPC (ruled out by the Python backend), GraphQL. Default: OpenAPI 3.1 generated by the backend, Hey API client with TanStack Query plugin, and a CI check that fails if the generated client is stale.
  [ADR 0017](adr/0017-orval-api-client.md) picks Orval instead, because Hey API's generator needs the TypeScript compiler API that TypeScript 7 does not ship.
  Done when the spike generates a client for two endpoints and a contract test compares the served schema with the committed one.

- [x] STACK-009 · Forms and validation
  Candidates: React Hook Form with Zod, TanStack Form with Zod or Valibot. Default: TanStack Form with Zod, with schemas generated from OpenAPI where possible.
  Done when the ADR covers report forms with conditional fields, which are the hardest case.
  Decided in [ADR 0045](adr/0045-forms-and-validation.md): TanStack Form with Zod 4, and report forms driven by template data with conditional fields.

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
  Refs mock 18, mock 21, kit Interaction spec.

### Viewer and rendering

- [x] STACK-015 · Viv and deck.gl versions and the WebGL2 versus WebGPU question
  Viv is primary and its layers are GLSL, so Viv runs on WebGL2. Decide the Viv and deck.gl versions, whether deck.gl 9.4 WebGPU runs as the alternate route, and how the luma.gl leak and debug-string fixes from doc 24 are applied (patch-package, upstream PR, or wrapper).
  Done when a spike opens CMU-1.svs in Viv on the chosen versions and passes the 20-slide-switch memory test (heap returns to baseline, one Deck alive).
  Refs docs 23, 24, [`poc/src/gl/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/gl), [`poc/src/viv/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/viv).

- [x] STACK-016 · TIFF and Zarr readers in the browser
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
  Decided in [ADR 0018](adr/0018-postgres-sqlalchemy-rls.md) except the Neon region, which needs a measurement from Modal once the cloud is back.

- [x] STACK-021 · Annotation and AI result storage model
  Options: PostGIS rows for human annotations plus columnar chunk files in object storage for model output (the POC split), everything in PostGIS, GeoParquet or FlatGeobuf files per job. Default: the split. Human annotations go in PostGIS with an append-only version table. Model output is stored as typed-array chunks per job tile in object storage with a summary index, and FlatGeobuf is used for export.
  Done when the ADR defines the chunk schema (including type probabilities, which the POC paged format dropped) and a spike pages 1.6M nuclei in the browser under the doc 31 budgets.
  Refs docs 11, 19, 31, 33. Decided in [ADR 0076](adr/0076-annotation-and-ai-result-storage.md).

- [x] STACK-022 · Background jobs and durable workflows
  Candidates: Temporal, Hatchet, Celery, Dramatiq, arq. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): job, step and tile tables in Postgres, steps run as Modal functions started with `spawn`, and a Modal cron function that resumes orphaned steps from the last completed tile. Temporal and Hatchet were set aside because they need always-on workers.
  Done when a spike runs a three-step workflow that survives a worker restart mid-step and resumes from the last completed tile.
  Refs doc 20 §5 (jobs must survive restart).
  Decided in [ADR 0044](adr/0044-background-jobs-and-workflows.md): Postgres job, step and tile tables with leases and `FOR UPDATE SKIP LOCKED`, proven by a kill test in [results/2026-10-14-durable-workflow-spike.md](results/2026-10-14-durable-workflow-spike.md).

- [x] STACK-023 · Authorization model
  Candidates: application RBAC with PostgreSQL row-level security, OpenFGA or SpiceDB for relationship-based sharing, Cerbos or OPA for policies. Default: RLS for hard tenant isolation, an RBAC permission table for roles, and OpenFGA only if guest links and cross-organisation sharing outgrow plain tables.
  Done when the ADR shows how a guest from organisation B reads one view of one case in organisation A without any other access, with the test plan for it.
  Decided in [ADR 0020](adr/0020-authorization-rls-scopes-and-rbac.md).

- [ ] STACK-024 · Realtime transport
  Candidates: FastAPI WebSockets with Valkey pub/sub, Centrifugo, Server-Sent Events plus POST, a managed service (Ably, Pusher, Liveblocks). Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare Durable Objects with WebSocket Hibernation, one room per case and one per user. Durable Objects carry ephemeral events only and Postgres stays the system of record. FastAPI posts events to a room over an authenticated internal route, and clients refetch on reconnect.
  Done when the spike shows presence and a thread update reaching two browsers under 300 ms on staging.

- [ ] STACK-025 · Object storage, CDN and signed access
  Candidates: S3, Google Cloud Storage, Azure Blob, Cloudflare R2, with CloudFront, Cloud CDN or Cloudflare in front. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare R2 with one bucket per environment, keys under `t/{tenant}/s/{slide}/`, and a Worker gateway under the app origin that verifies capability tokens and serves byte ranges through the R2 binding. Presigned URLs are for uploads only, because presigned GETs work only on the S3 API domain and bypass the CDN. Requirements are HTTP/2 or HTTP/3 at the edge, Range requests, signed URLs or signed cookies scoped to a tenant and slide, COOP and COEP header injection, and no SPA fallback on data paths.
  Done when a spike measures cold and warm tile fetch latency through the Worker gateway, with and without a Cache API layer keyed per byte range, for SVS byte ranges and OME-Zarr chunks.
  Refs docs 09, 20 §3.2, 32.

- [x] STACK-026 · Slide reading and tiling on the server
  Candidates: OpenSlide 4 with openslide-python, tiffslide, tifffile, TIAToolbox, bioformats2raw for conversion fallbacks, MONAI Label as middleware. Default: tifffile and tiffslide (plus OpenSlide where it reads better) for validation, indexing, thumbnails and patches, TIAToolbox for pixel-size-aware tiling in ML workers, no MONAI Label server. Doc 20 found that only its endpoint shape and datastore were still in use.
  Done when the ADR lists, per POC format, which server library reads it and which fixture proves it.
  Refs docs 08, 12, 17, 20 §5.
  Decided in [ADR 0043](adr/0043-server-slide-reading.md): OpenSlide first, tiffslide for OME-TIFF, tifffile for validation and wsidicom for DICOM. The automated fixture tests belong to INGEST-003 (ingest workflow skeleton).

- [ ] STACK-027 · GPU inference serving
  Candidates: plain PyTorch workers pulling from the workflow engine, NVIDIA Triton, Ray Serve, BentoML. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): PyTorch in Modal GPU functions per model family. Batch work starts cold. Interactive embeddings run in a separate function that the API pre-warms when a slow device activates the segmentation tool, and it scales down after about 5 idle minutes. Separate containers replace the priority gate. Triton is reconsidered when the model count grows.
  Done when a spike shows an interactive embedding request served within 1 s from a pre-warmed container while a whole-slide job runs, and records the cold-start time.
  Refs doc 19 (GPU gate), doc 26 (job ops).

- [x] STACK-028 · Identity provider
  Candidates: Keycloak (self-hosted), Zitadel, WorkOS, Auth0, Clerk. Criteria: OIDC with PKCE, MFA, organisation SSO later, EU hosting, HIPAA BAA, cost per user. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Zitadel Cloud on the free plan. FastAPI is a confidential OIDC client in the BFF pattern. The browser holds only an HttpOnly, Secure, SameSite=Strict session cookie, and sessions and refresh tokens live in Postgres.
  Done when the ADR records the choice and a spike logs in through the BFF, refreshes tokens server-side without the SPA noticing and maps IdP organisations to tenants. Decided in [ADR 0025](adr/0025-zitadel-bff-login.md).

### Platform and operations

- [ ] STACK-029 · Cloud provider, regions and GPU availability
  Candidates: AWS, Google Cloud, Azure, plus an EU sovereign option. Criteria: EU region with GPU instances (L4, L40S, A100 or H100), HIPAA BAA, ISO 27001 certified regions, managed Postgres with PostGIS, managed Kubernetes. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): no single cloud. Cloudflare (Workers, Durable Objects, R2, Pages), Modal (Python and GPUs) and Neon (Postgres), with no region pinning during the pilot.
  Done when the ADR includes a monthly cost estimate for the pilot (three tenants, 5,000 slides per month).

- [x] STACK-030 · Infrastructure as code, deploy and runtime platform
  Candidates: OpenTofu or Terraform, Pulumi. Kubernetes with Helm and Argo CD, or a simpler container platform (Cloud Run, ECS). Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): no Kubernetes. Wrangler config for the edge, Modal app code for Python, the Neon API for branches, GitHub Actions for deploys, and a small OpenTofu module for DNS, buckets and the Zitadel and Neon projects.
  Done when the ADR covers preview environments per pull request for the web app and API.
  Decided in [ADR 0050](adr/0050-deploy-pipeline-and-previews.md): no Kubernetes, one Worker, Modal app and Neon branch per pull request, torn down on close and by a nightly sweep.

- [ ] STACK-031 · Model licensing policy (on hold)
  Decide whether the product is commercial, then which models may run in which tenant type. HoVer-NeXt and VISTA-2D weights are CC BY-NC-SA 4.0. Verify PathoSAM, SlimSAM, NuClick, SAM2, the MONAI bundles and any foundation models (UNI2, Virchow2, H-optimus, Prov-GigaPath) from their hosted weight licences, not from repository licences. Review the training and calibration datasets (PanNuke, CoNSeP, CAMELYON16) the same way.
  Done when the ADR has a licence matrix (model, weights licence, data licence, allowed tenant types) and the model registry (AIP-002) enforces it.
  Refs docs 17, 29, [`poc/docs/presentation2/SlideViewersOneClick.html`](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/presentation2/SlideViewersOneClick.html).
  On hold since 2026-10-15. The owner said Parfocal will not really be commercial and licensing does not matter for now, so [ADR 0042](adr/0042-model-licensing-policy.md) (commercial from the first pilot) was rejected. Its licence matrix of 25 models and 10 datasets stays as reference. Revisit before any paying tenant.

- [x] STACK-032 · Observability
  Candidates: OpenTelemetry SDKs everywhere, then Grafana stack (Loki, Tempo, Mimir or Prometheus), Datadog, or Honeycomb. Error tracking with Sentry (self-hosted or EU). Frontend real-user monitoring for viewer frame times. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): OpenTelemetry to the Grafana Cloud free tier, Sentry SaaS free plan, Workers Logs and Modal logs, exporting only from production with console output in every other environment ([ADR 0005](adr/0005-external-sends-only-in-production.md)), and a PHI scrubber in every pipeline.
  Done when the ADR defines the PHI scrubbing rules and a test proves a patient name in a log line is redacted.
  Decided in [ADR 0040](adr/0040-observability-and-phi-scrubbing.md). The scrubber is `parfocal_common.scrubbing`. FOUND-011 (structured logging) wires it into the API's logging.

- [ ] STACK-033 · Feature flags, experiments and product analytics
  Candidates: GrowthBook, PostHog (self-hosted EU), Unleash, Statsig. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): PostHog Cloud for flags, experiments, analytics and surveys, with autocapture and session replay off. Only production sends events and evaluates flags in PostHog, and other environments read flag defaults from a local file ([ADR 0005](adr/0005-external-sends-only-in-production.md)). No PHI ever leaves the platform in events.
  Done when a spike assigns users to the arms of an experiment, such as the lab leads' default home, and records an exposure event without identifiers beyond a pseudonymous user id.

- [x] STACK-034 · Search
  Candidates: PostgreSQL full-text search with pg_trgm, Meilisearch, OpenSearch. Default: PostgreSQL FTS and trigram, because patients, cases and reports are tenant-scoped and small per tenant, and RLS then covers search too.
  Done when the spike returns patient, case and report results for a partial name in under 100 ms on 100,000 seeded cases.
  Decided in [ADR 0094](adr/0094-search-on-postgres.md) with the [search spike](results/2026-10-18-search-spike.md). Reports are not stored yet and patient names are searched by whole words by ADR 0034, so the spike measured cases, slides and whole-word patients.

- [x] STACK-035 · PDF generation for reports
  Candidates: Typst, WeasyPrint, headless Chromium (Playwright) print, ReportLab. Default: Typst for deterministic, versionable templates, or WeasyPrint if templates must share HTML and CSS with the web preview.
  Done when the spike renders the sentinel node report with a signature block and AI disclosure in both preview and PDF with matching content.
  The report is now the evaluation report ([ADR 0053](adr/0053-ai-results-review-direction.md)). Decided in [ADR 0083](adr/0083-typst-for-report-pdfs.md): Typst, after a [spike](results/2026-10-18-pdf-generation-spike.md) rendered it with a signature line and the AI disclosure, as PDF and as an SVG preview of the same compile.

- [x] STACK-036 · Email and transactional notifications
  Candidates: Amazon SES, Postmark, Resend, SendGrid, with EU data processing and BAA where needed. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): Resend through its HTTP API in production only. Other environments use a console sender and automated tests an in-memory fake ([ADR 0005](adr/0005-external-sends-only-in-production.md)). Templates are rendered server-side and no PHI goes in subject lines.
  Done when the ADR covers bounce handling and the PHI rules.
  Decided in [ADR 0039](adr/0039-email-through-resend-with-phi-rules.md): Resend in production only, no PHI in email, signed bounce webhooks feeding a suppression list.

- [x] STACK-037 · Secrets and key management
  Candidates: cloud KMS with envelope encryption, HashiCorp Vault or OpenBao, External Secrets Operator for Kubernetes. Default per [ADR 0003](adr/0003-pilot-platform-architecture.md): application-level envelope encryption. Per-tenant data keys are wrapped by a master key held as a Modal secret, and sensitive columns are AES-GCM encrypted in FastAPI. Moving the master key to a KMS is a trigger before real PHI. Runtime secrets live in Modal secrets, Wrangler secrets and GitHub environments.
  Done when the ADR defines key rotation and how a tenant's data becomes unreadable after crypto-shredding on erasure.
  Decided in [ADR 0033](adr/0033-envelope-encryption-with-tenant-data-keys.md). `parfocal_common.envelope` holds the keyring and field format.

- [x] STACK-038 · CI provider and runners
  Candidates: GitHub Actions with hosted runners plus a self-hosted GPU runner, GitLab CI, Buildkite. Default: GitHub Actions, plus one GPU runner for golden-image, WebGPU and perf suites.
  Done when the ADR lists which suites run on every pull request, nightly and before release.
  Decided in [ADR 0011](adr/0011-hosted-ci-only.md), which supersedes ADR 0010: GitHub Actions on hosted runners only, no self-hosted runners and no GPU-heavy suites.

- [x] STACK-039 · Resumable upload protocol
  Candidates: tus (tusd or tus-py), S3 multipart with presigned parts (Uppy), Google resumable uploads. Default: S3-style multipart with presigned parts via Uppy on the client against R2's S3 API ([ADR 0003](adr/0003-pilot-platform-architecture.md)), with bucket CORS allowing the app origin. This avoids routing multi-gigabyte slides through the API.
  Done when a spike uploads a 4 GB NDPI over a throttled connection with a forced disconnect and resumes without restarting.
  Proposed in [ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md), measured in [the upload spike](results/2026-10-31-resumable-upload-spike.md) against MinIO with a 4 GiB synthetic file and the 1.99 GB `OS-1.ndpi`, because no 4 GB NDPI fixture exists. The owner accepted the ADR on 2026-10-31.

- [x] STACK-040 · FHIR and HL7 libraries
  Candidates: fhir.resources (Pydantic), HAPI FHIR as an external server, python-hl7 for v2. Default: fhir.resources for parsing and building Patient, ServiceRequest, Specimen and DiagnosticReport, and no FHIR server in v1.
  Done when the ADR fixes the FHIR version (R4 or R5) and the resources in scope.
  Decided in [ADR 0035](adr/0035-fhir-r4-through-fhir-resources-r4b.md): R4 on the wire through fhir.resources' R4B models.

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

- [x] FOUND-007 · CI pipeline for pull requests
  Jobs for install with cache, lint, typecheck and unit tests for TS and Python, plus one `ci-ok` job that a branch rule requires. Turborepo remote cache if allowed. The API contract check and image builds moved to FOUND-018 because they need FOUND-008 and FOUND-015.
  Done when a pull request shows all jobs and a failing unit test blocks merge.
  Depends on STACK-038.

- [x] FOUND-008 · OpenAPI generation and client codegen pipeline
  The API emits OpenAPI 3.1, `packages/api-client` is generated from it with Orval ([ADR 0017](adr/0017-orval-api-client.md)), and CI fails when the committed client is stale.
  Done when a contract test proves the served schema equals the committed one.
  Depends on STACK-008, STACK-019.

- [ ] FOUND-009 · Local development environment
  Docker Compose with Postgres plus PostGIS and a PgBouncer in transaction mode like Neon's (the compose file exists since FOUND-013). The Vite dev server runs the edge Worker and Durable Objects through the Cloudflare Vite plugin with a remote binding to the `parfocal-dev` R2 bucket, FastAPI runs under uvicorn and jobs run in-process behind the same runner interface as Modal. Zitadel Cloud and the dev bucket are real cloud resources configured through `.env` ([ADR 0004](adr/0004-cloud-dev-resources.md)). One command starts everything. Seeded dev tenant. See [knowledge/local-dev.md](knowledge/local-dev.md).
  Done when a new machine runs `make dev` (or equivalent) and reaches the logged-in home screen in under 10 minutes, documented in the README.

- [x] FOUND-010 · Configuration and settings management
  Typed settings in Python (pydantic-settings) and a typed runtime config for the web app. No secrets in the frontend bundle. One `APP_ENV` setting (`dev`, `test`, `preview`, `staging`, `prod`) picks the email, error reporting, telemetry export, analytics and flag clients at startup, and only `prod` talks to Resend, Sentry, Grafana Cloud and PostHog ([ADR 0005](adr/0005-external-sends-only-in-production.md)).
  Done when a test fails startup on a missing required setting, the web build fails if a non-public variable is referenced, and a test shows that with any `APP_ENV` other than `prod` no client for those services is created.

- [x] FOUND-011 · Structured logging with tenant and request context
  JSON logs, request id, tenant id, user id as pseudonymous ids, PHI scrubber.
  Done when a test shows a patient name passed to a logger is redacted.
  Depends on STACK-032.

- [x] FOUND-012 · Error handling conventions
  RFC 9457 problem details in the API and a typed error mapping in the client. The user-facing toasts moved to FOUND-019 because the UI is not final.
  Done when contract tests cover 400, 401, 403, 404, 409 and 422 shapes.

- [x] FOUND-013 · Database baseline and migrations
  Alembic set up, naming conventions, `tenant_id` on every tenant-owned table, created and updated timestamps, soft-delete policy decided.
  Soft delete is decided in [ADR 0019](adr/0019-soft-delete-policy.md).
  Done when a migration test upgrades and downgrades an empty database in CI.
  Depends on STACK-020.

- [ ] FOUND-014 · Dependency and licence scanning (on hold)
  Renovate or Dependabot, `pip-audit`, `pnpm audit`, licence allowlist for npm and PyPI.
  Done when a disallowed licence in a test dependency fails CI.
  On hold since 2026-10-08. The owner does not need licence checks or dependency update automation for now. Notes for when it resumes are in the log entry of that date.

- [ ] FOUND-015 · Container images
  Modal image definitions for the API, ingest and ML (CUDA base) functions with pinned versions, plus a multi-stage Dockerfile for the API so it can run on another host ([ADR 0003](adr/0003-pilot-platform-architecture.md)). The web app is static assets on Cloudflare. Non-root, pinned digests, SBOM output.
  Done when the API image and the Modal images build in CI and a container scan of the API image reports no critical vulnerabilities.

- [x] FOUND-016 · Shared test fixtures package
  `packages/test-fixtures` documents how to fetch large fixtures (CMU-1 family, CAMELYON16 tumor_009 and test_001, OpenSlide corpus) into a cache, plus tiny synthetic slides committed in the repo.
  Done when `pnpm fixtures` downloads with checksums and CI caches them.
  `PARFOCAL_FIXTURES_LOCAL` links verified slides already on disk, such as the POC's copies, instead of downloading them.
  Refs [`poc/scripts/fetch-formats.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/fetch-formats.mjs), [`poc/scripts/fetch-camelyon.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/fetch-camelyon.mjs).

- [x] FOUND-017 · Release versioning and changelog
  Done when conventional commits are enforced and a changelog is generated per release tag.
  Conventional Commits with the backlog ID as scope, commitlint and a local git-cliff release ([ADR 0014](adr/0014-conventional-commits-and-releases.md)).

- [ ] FOUND-019 · User-facing error toasts
  Split from FOUND-012. Show `ApiError` kinds from `@parfocal/api-client` as toasts or inline field errors in the kit's style, never with stack traces or server detail meant for logs.
  Done when component tests cover each error kind and an axe check passes.
  Depends on FOUND-012 and the final UI shell.

- [ ] FOUND-018 · Contract check and image builds in CI
  Split from FOUND-007. Add the web, API and Modal image builds as jobs that `ci-ok` requires. The API contract test and the generated-client check already run in the `test` job since FOUND-008.
  Done when a pull request that changes the API schema without regenerating the client fails, and image builds run on every pull request.
  Depends on FOUND-007, FOUND-008, FOUND-015.

- [ ] FOUND-020 · Task board over the backlog
  A kanban page and a command-line tool that read `docs/BACKLOG.md` live, so the owner can follow every task and agents can pick, claim and hand over tasks in parallel. Ticks stay in the backlog and claims live in one small file per task under `docs/board/active/` ([ADR 0052](adr/0052-task-board-from-backlog-and-claim-files.md)). The page links each task to its dependencies both ways with a tree view, and to the ADRs, results, knowledge files and log entries that name it.
  Done when `scripts/test_board.py` covers parsing tasks, dependencies, claim files, status resolution, the trees and `board.py check`, and the docs workflow runs the check.

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

- [x] SKEL-003 · Minimal tenant, user, project and slide tables
  Done when API tests create a project for the user's tenant and another tenant's user gets 404 for it.
  Depends on IAM-003, PROJ-001. Met by PROJ-001 and ADAPT-004: `test_projects.py` creates a project in the user's workspace and `test_another_workspace_gets_nothing` gets 404 from another workspace, and `slides` belongs to a project ([ADR 0063](adr/0063-cases-and-slides-in-projects.md)).

- [ ] SKEL-004 · Upload one SVS and its result file into a project
  Presigned multipart upload, objects land under the tenant's prefix, a slide row and a result set row are created.
  Done when an E2E test uploads CMU-1-Small-Region.svs with a small GeoJSON and both show in the project.
  Depends on INGEST-001, INGEST-002, RSET-001.

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

- [ ] SKEL-008 · Stub verdict and submit
  One Agree, Disagree or Not sure on the drawn polygon and a submit that records the reviewer and the time and moves the slide to submitted. Replaces the stub report and sign-out ([ADR 0053](adr/0053-ai-results-review-direction.md)).
  Done when an E2E test submits and the slide shows as submitted in a list, with an audit log entry.
  Depends on GUIDE-001, SEC-003.

- [ ] SKEL-009 · CI deploys main to staging
  Done when merging to main deploys automatically and the skeleton E2E suite runs against staging after deploy.
  Depends on OPS-005.

- [ ] SKEL-010 · Skeleton retrospective
  Done when an ADR lists what the skeleton revealed (latency, memory, gaps) and the backlog is edited to reflect it.

---

## 03 IAM · Identity, tenancy, roles, guest access

- [x] IAM-000 · Research check for identity and authorization
  Done when STACK-023 and STACK-028 are confirmed or revised in an ADR.
  Both confirmed in [ADR 0041](adr/0041-identity-and-authorization-rechecked.md).

- [ ] IAM-001 · IdP deployment and configuration
  Organisation setup in Zitadel Cloud, a confidential client for the API's BFF login ([ADR 0003](adr/0003-pilot-platform-architecture.md)), MFA policy (TOTP and WebAuthn).
  Done when the IdP config is code (exported realm or Terraform provider) and recreated from scratch in CI.
  Depends on STACK-028.

- [x] IAM-002 · Login, logout and session refresh through the BFF
  FastAPI runs the OIDC code flow and refreshes tokens server-side. The SPA only sees a session cookie ([ADR 0003](adr/0003-pilot-platform-architecture.md)). The session lookup is `authenticate` in `parfocal_api.auth` and returns a signed-in user or a platform operator, who is a row in `platform_operators` ([ADR 0024](adr/0024-workspaces-are-tenants.md), [ADR 0025](adr/0025-zitadel-bff-login.md)). IAM-005 turns a signed-in user into a member of the chosen workspace.
  Done when Playwright covers login, refresh after expiry, logout and redirect back to the deep link the user started from.

- [x] IAM-003 · Tenants and organisations
  Tenant table, slug, region, plan, status. An organisation can hold several workspaces (diagnostic, research de-identified, second-opinion network). Each workspace is a tenant and the organisation groups them ([ADR 0024](adr/0024-workspaces-are-tenants.md)).
  Done when API tests create, suspend and reactivate a tenant and a suspended tenant's users are refused.
  Refs kit IA "Other workspaces", mock 1 org switcher, [ADR 0024](adr/0024-workspaces-are-tenants.md).

- [x] IAM-004 · Tenant context and row-level security
  Every request sets the tenant in the database session. RLS policies on every tenant-owned table.
  Done when an isolation test suite runs every list and get endpoint as a user of tenant B against data of tenant A and gets nothing. The suite runs automatically on every new table.
  Depends on FOUND-013.

- [x] IAM-005 · Users, memberships and profiles
  User row linked to the IdP subject, membership per tenant (each workspace is a tenant, [ADR 0024](adr/0024-workspaces-are-tenants.md)), display name, initials, avatar colour, title (MUDr.). A member principal is accepted only with an active membership in its tenant.
  Done when API tests cover membership in two tenants and switching between them.

- [x] IAM-006 · Roles and permissions
  Roles: consultant pathologist, resident, lab lead, lab staff, administrator and outside consultant, with the UX kit's permission matrix ([ADR 0026](adr/0026-roles-and-permission-matrix.md)). A permission matrix in code and a generated doc page. Platform operators sit outside the matrix and only reach `/api/platform/*` ([ADR 0024](adr/0024-workspaces-are-tenants.md)).
  Done when a table-driven test asserts every endpoint's permission for every role.

- [x] IAM-007 · Invitations
  Admins invite by email with a role, invites expire, acceptance creates the membership.
  Done when E2E covers invite, accept and expiry, and the audit log records each step.
  Built as [ADR 0030](adr/0030-invitations-bound-to-verified-email.md) says. The `/invitations/{token}` page waits for the final UI.

- [ ] IAM-008 · Workspace switcher
  The top-left organisation and workspace switcher from mock 1 and kit W1.
  Done when a component test and an E2E test switch workspace and the worklist reloads in the new scope.

- [x] IAM-009 · Session policies
  Idle lock after the lab-set time (default 15 min), "sign out on other devices", concurrent session list, and a session lifetime set per workspace instead of IAM-002's fixed 12 h. Built as [ADR 0031](adr/0031-idle-lock-from-explicit-activity.md) says.
  Done when tests cover lock, unlock by signing in again, and remote session revocation.
  The lock screen and the return to the same camera position moved to IAM-021. Refs mock §2.15 Privacy and session.

- [ ] IAM-010 · Idea: Guest consultant links
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Guest consultants belong to the second-opinion idea.
  Expiring, revocable links scoped to one case, optionally one view and its threads, for a user from another organisation. The guest signs in with their own IdP account or a verified email.
  Done when tests prove the guest can read only that case and post only in the shared threads, the link expires, and revocation takes effect within one minute.
  Depends on STACK-023. Refs kit Flow 3, mock 12.

- [x] IAM-011 · Service accounts and API tokens
  For integrations (LIS adapter, import scripts), with scopes and rotation.
  Done when tests cover scope enforcement and token revocation.
  Built as [ADR 0029](adr/0029-service-accounts-with-own-api-tokens.md) says.

- [ ] IAM-012 · Per-organisation SSO
  SAML or OIDC federation per tenant through the IdP, with just-in-time provisioning and role mapping.
  Done when an E2E test logs in through a test SAML IdP.

- [ ] IAM-013 · SCIM provisioning
  Done when a SCIM test client creates, updates and deactivates users.
  Depends on IAM-012.

- [ ] IAM-014 · Admin console for users and roles
  Admin page screen to list members, change roles and admin rights, deactivate and resend invites.
  Done when component and E2E tests cover each action and each action is audited.
  The screen is ADMIN-003 in the admin page.

- [x] IAM-015 · Availability status and back-up
  Each user can be available, busy until a time (for example during a tumor board) or away with a named back-up. Reassigning (BOARD-007), routing (CASES-011) and STAT notifications (NOTIF-003) respect it, and the account menu (SHELL-012) sets it.
  Done when API tests cover each status and its expiry, and a routing test sends a new case to the back-up of an away user.
  Refs [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md), [ADR 0051](adr/0051-availability-status-and-back-up.md).


- [x] IAM-016 · Roles narrowed by folders
  A membership carries the folders (services) the person works in. Permissions marked folder-scoped in the matrix (see cases, create and edit cases, upload, move slides, take cases, make calls, order lab work, ask for a second opinion, prepare a tumor board, read the team page) apply only inside those folders. Leads may be given every folder. Outside consultants never have folders and keep their guest grant.
  Done when the table-driven permission test from IAM-006 runs every folder-scoped permission inside and outside the folders, and an isolation test proves a list endpoint hides cases of other folders.
  Depends on IAM-006, CASES-003. Refs kit Roles and access page, [ADR 0023](adr/0023-gap-review-backend-first.md). Built as [ADR 0046](adr/0046-roles-narrowed-by-folders.md) says.

- [x] IAM-017 · Emergency access with a reason
  A person may open a case outside their folders after giving a reason. The grant lasts a lab-set time (default 4 h), covers that case only, is marked in the audit log and notifies the folder's lead. Administrators have no patient data permissions and use the same path when they must look at a case.
  Done when API tests cover grant, expiry and refusal without a reason, the audit entry carries the reason, and a permission test proves an administrator cannot read a patient without it.
  Depends on IAM-016, SEC-003. Refs kit W65, kit W71, [ADR 0023](adr/0023-gap-review-backend-first.md). Built as [ADR 0047](adr/0047-emergency-access-with-a-reason.md) says. Notifying the folder's lead waits for NOTIF-001 (notification service).

- [x] IAM-018 · Supervision and signing rights
  A person record holds whether they may sign alone, their supervisor if they may not, and whether a signature is on file. A resident's sign-out is refused and becomes a send-for-review (REPORT-019). A consultant without a signature on file cannot sign. Changing these is a lead's action and is audited.
  Done when API tests cover each combination and the refusal messages, and the audit log records every change.
  Depends on IAM-006. Refs kit W48, kit Flow 14. Built as [ADR 0032](adr/0032-signing-rights-on-the-membership.md) says.

- [ ] IAM-019 · Idea: Sign-in by emailed code for outside consultants
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Guest consultants belong to the second-opinion idea.
  An invited outside consultant signs in with a one-time code sent to the invited address. The code works once, for 10 minutes, and is rate limited per address and per IP. A code for one address never opens another account. The resulting session carries only the guest grants of IAM-010.
  Done when API tests cover success, reuse, expiry, a wrong address, the rate limit and a session that cannot reach anything beyond the grant.
  Depends on IAM-010. Refs kit W49, kit W62, kit Flow 21, [ADR 0023](adr/0023-gap-review-backend-first.md).

- [ ] IAM-020 · Deactivation with hand-over
  Deactivating a person first lists their open work: review tasks they are on, tasks they own, adjudications and open threads. Each item must be reassigned or returned before the deactivation is accepted, either now or at a chosen end date. At the end date their sessions are revoked and they cannot sign in. Their verdicts, sign-offs and audit history stay.
  Done when API tests refuse a deactivation with open work, apply one with every item moved, run a scheduled end date with a fake clock, and confirm signed-off evaluations still verify.
  Depends on IAM-014, TASK-007, ADJ-003. Refs kit W51, kit Flow 25.

- [ ] IAM-021 · Lock screen that returns to the same view
  Split from IAM-009. The web app sends `recordActivity` on keyboard, pointer and viewer input at most once a minute, shows the kit's lock screen when the API answers `session-locked`, unlocks through `/api/auth/login?reauth=true` and comes back to the same view and camera position.
  Done when a component test and an E2E test lock an open slide, unlock and find the same camera position.
  Depends on IAM-009 and the final UI shell. Refs mock 23 Sign in and lock, mock §2.15 Privacy and session.

- [x] IAM-022 · Researcher, reviewer and admin roles with project roles
  Workspace roles researcher, reviewer and admin, and project roles owner, reviewer and viewer, replace the five membership roles left after ADAPT-001 in the permission matrix, in the `memberships` and `invitations` role checks and in the service account scopes. The kept and reworked permissions are renamed for the new product as [ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md) lists, and "assigned to them" becomes "in their tasks". No memberships are mapped, because the code is throwaway. A reviewer sees only the projects and tasks they are in. A researcher creates projects, uploads, runs models, creates tasks, resolves disagreements and signs off. An admin manages people, models, sources and security and sees no patient data without IAM-017.
  Done when the table-driven permission test from IAM-006 covers every new role on every endpoint, invitations keep working with the new roles, and an ADR supersedes ADR 0026. Hiding a project from a reviewer who is not in it is tested in PROJ-003.
  Depends on IAM-006, ADAPT-001. Refs doc 37 "Product and roles", [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] IAM-023 · Sign in and unlock with a passkey
  Sign in and the lock screen offer "Sign in with a passkey" and "Unlock with a passkey" next to the other ways in. The button starts the BFF login with the identity provider's passwordless flow, the browser shows its own passkey window, and a passkey on a phone or security key works through the browser's QR option. Unlocking returns to the same view as IAM-021. Enrolment prompts, a passkey list in settings and an admin policy are not part of this task ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)).
  Done when E2E with a virtual WebAuthn authenticator signs in with a passkey and unlocks a locked slide to the same camera position, and a test shows a cancelled passkey window leaves the sign-in page usable.
  Depends on IAM-001, IAM-002, IAM-021. Refs mock: signin/passkey, mock: signin/lockkey, doc 42.

- [x] IAM-024 · Admin as a right of a researcher
  `Role` keeps `researcher` and `reviewer`, and `memberships` and `invitations` gain `admin_rights`, which only a researcher may hold. Admin rights grant `manage-people`, `workspace-settings`, `integrations`, `report-templates` editing and `audit-log`, and add no access to project data. Every admin membership and invitation becomes a researcher with admin rights. Removing the right from the last holder is refused, and giving or removing it is audited. The permission page is regenerated with the responsibilities of each role ([ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md)).
  Done when the table-driven permission test covers a researcher with and without admin rights and a reviewer on every endpoint, a migration test turns an admin membership and an invitation into a researcher with admin rights, an API test refuses removing the last holder and refuses the right on a reviewer, and the audit entry is checked.
  Depends on IAM-022. Refs doc 43, kit: Pipeline and roles.

---

## 04 SEC · Security and compliance (GDPR, HIPAA, ISO 27001 readiness)

- [x] SEC-000 · Research check for compliance controls
  Map GDPR articles, the HIPAA Security Rule safeguards and ISO 27001:2022 Annex A controls to the backlog.
  Done when a control matrix in `docs/compliance/controls.md` links each control to a task ID or marks it as policy work.
  The matrix is [compliance/controls.md](compliance/controls.md). Its 9 gaps are listed there as candidate tasks. TODO: control names were written from memory and must be checked against the standards' texts.

- [x] SEC-001 · Data classification and PHI inventory
  Classify every field (PHI, personal, operational, public). Generate a data map from model annotations in code.
  Done when a CI check fails if a new column lacks a classification.
  Classes and where they are declared are in [ADR 0028](adr/0028-data-classes-on-columns.md).

- [ ] SEC-002 · Encryption in transit and at rest
  TLS 1.2+ everywhere including internal traffic, encrypted volumes, buckets and backups, HSTS.
  Done when an automated config test (for example tfsec or checkov rules) passes and a TLS scan scores A.

- [x] SEC-003 · Audit log
  Append-only audit table with hash chaining. Every PHI read (case open, slide open, report view), every write that matters clinically (annotation accept, review decision, sign-out, amendment), every permission change. Export for auditors.
  Done when tests prove entries cannot be updated or deleted by the app role, the chain verifies, and an auditor export lists a case's full history.
  Built as [ADR 0027](adr/0027-audit-log-hash-chain-in-postgres.md) says. PHI reads and clinical writes are recorded by the tasks that build them, through `parfocal_api.audit.record`.
  Refs Concentriq report (21 CFR Part 11, ALCOA+).

- [x] SEC-004 · Field-level encryption for direct identifiers
  Patient name, MRN and birth date encrypted with tenant data keys from `parfocal_common.envelope` ([ADR 0033](adr/0033-envelope-encryption-with-tenant-data-keys.md)), stored wrapped in a `tenant_keys` table. Search uses blind indexes under a per-tenant index key that is destroyed with the data keys.
  Done when tests show ciphertext at rest, correct search, and unreadable data after the tenant key is destroyed.
  Depends on STACK-037. Search is decided in [ADR 0034](adr/0034-blind-indexes-for-encrypted-patient-identifiers.md).

- [ ] SEC-005 · Data residency enforcement
  Tenant region pins storage, database and GPU processing to that region. Not enforced during the pilot. Built before the first tenant with real PHI ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when a test fails if a job for an EU tenant is scheduled on a non-EU queue.

- [x] SEC-006 · Retention policies
  Per tenant retention for slides, annotations, reports and audit records, with legal hold.
  Done when a scheduled job test deletes expired data, skips held data and audits the deletion.
  Refs [ADR 0089](adr/0089-retention-purge-and-audit-re-anchor.md).

- [x] SEC-007 · Right to access and erasure workflows
  Export all personal data for a data subject. Erase or pseudonymise on request where law allows, with reports kept per legal duty.
  Done when tests cover both workflows end to end.
  Refs [ADR 0090](adr/0090-access-export-and-erasure.md).

- [ ] SEC-008 · De-identified projects
  A de-identified project never holds a direct identifier. Upload strips names and record numbers from file metadata and hides label and macro images. Copying slides from a clinical project into a de-identified one replaces case IDs with stable pseudonyms and removes label images.
  Done when tests prove no direct identifier, label image or macro image with a barcode reaches a de-identified project, through upload, link import, webhook and copy.
  Depends on PROJ-002, SEC-009. Refs doc 37 "Data model", [ADR 0053](adr/0053-ai-results-review-direction.md).

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

- [x] SEC-012 · Rate limiting and abuse protection
  Per user and per tenant limits on API and upload, bot protection on auth.
  Done when load tests show limits enforced with proper 429 responses.
  Refs [ADR 0088](adr/0088-rate-limits-in-postgres-and-at-the-edge.md). Per-IP limits and bot protection on login moved to SEC-027.

- [ ] SEC-013 · Secrets management in all environments
  Done when no secret exists in the repo (scanner in CI), runtime secrets come from the secret store, and rotation is documented and tested on staging.
  Depends on STACK-037.

- [ ] SEC-014 · Backups and restore testing
  Point-in-time recovery for Postgres, versioned buckets for slides and results. TODO: confirm whether R2 supports object versioning, and if not, use write-once keys plus a protected copy.
  Done when a monthly automated restore into a scratch environment passes integrity checks.

- [ ] SEC-015 · Vulnerability management
  Container, dependency and IaC scanning with SLAs by severity.
  Done when the scanners gate CI and a weekly report is generated.

- [x] SEC-016 · Threat model
  STRIDE threat model for upload, tile access, guest links, AI jobs and realtime.
  Done when `docs/security/threat-model.md` exists and each high risk links to a mitigation task.
  Refs [threat model](security/threat-model.md).

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

- [ ] SEC-023 · Idea: Electronic signature record for sign-out
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Sign-off of an evaluation confirms with single sign-on instead (ADJ-004).
  Sign-out requires re-authentication within a short window and records meaning, signer, time and content hash.
  Done when tests prove a signed report's hash detects tampering.
  Refs REPORT-008.


- [x] SEC-024 · Audit log queries and signed export
  Query the audit log by person, patient, case, kind of action and dates. Leads see their department, administrators everything, nobody can change it. An export is a signed file that lists every matching entry with emergency access and its reason marked, for a patient's access request or an inspection.
  Done when API tests cover each filter and the permission split, and a test verifies the export's signature and that it matches the hash chain from SEC-003.
  Depends on SEC-003, IAM-017. Refs kit W71, kit Flow 29. Built as [ADR 0073](adr/0073-audit-queries-and-signed-export.md) says: leads and departments are gone, so admins see the whole workspace.

- [x] SEC-025 · Origin check on cookie writes
  Requests with an unsafe method and the session cookie are refused unless their `Origin` header, or `Sec-Fetch-Site: same-origin` when it is absent, matches the app origin. SameSite=Strict does not stop a sibling subdomain of the same site ([threat model](security/threat-model.md) X1).
  Done when API tests refuse a write from another origin and from a same-site subdomain, accept one from the app origin, and leave service tokens and the login callback working.

- [ ] SEC-026 · Isolated parsing of uploaded files
  Slide readers and result parsers run in a worker with no network egress except the job's own storage keys, no secrets beyond a job token scoped to one tenant and slide, a memory and time limit and a non-root user ([threat model](security/threat-model.md) U2).
  Done when a test shows a parser job cannot reach the network or read another key, and an oversized or slow parse is stopped and reported as a failed check.
  Depends on AIP-006, INGEST-003.

- [ ] SEC-027 · Edge limits per IP
  The edge Worker limits login, upload and tile requests per client address with Cloudflare's rate limiting binding, and adds bot protection to login ([threat model](security/threat-model.md) X3 and T4).
  Done when a test against a preview shows a login flood from one address answered with 429 while another address signs in.
  Depends on SEC-012, STACK-025. Split from SEC-012 by [ADR 0088](adr/0088-rate-limits-in-postgres-and-at-the-edge.md).

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

Since [ADR 0053](adr/0053-ai-results-review-direction.md) an upload carries slides and their AI result files together through three steps, Files, Check and Upload (mock: upload, [ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)). Result files are read and checked by the RSET epic, and no model runs on arrival.

Formats in scope, all read natively: Aperio SVS (JPEG and JPEG 2000), generic tiled TIFF, OME-TIFF (8 and 16 bit), Hamamatsu NDPI (including files above 4 GB), Ventana BIF, Leica SCN, Philips TIFF, Huron TIFF, ARGOS TIFF, OME-Zarr v0.4 and v0.5 (sharded). Out of scope for v1 (later epic): MRXS, iSyntax, CZI, VSI, DICOM WSI. Doc 08 has the per-format findings.

Conversion policy: the original is never altered. A conversion to OME-Zarr is produced only when a trigger fires, and the viewer then reads the converted copy while the original remains the record. Triggers are an unreadable format, a reader correctness failure that cannot be worked around, or a performance budget failure from VIEW-040. Each trigger has an ADR.

- [ ] INGEST-000 · Research check for upload and server readers
  Done when STACK-026 and STACK-039 are confirmed or revised in an ADR.

- [ ] INGEST-001 · Upload API with presigned multipart
  Create upload, get part URLs, list parts, complete, abort. Uploads land in a tenant-scoped quarantine prefix. Per [ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) the routes follow Uppy's Companion S3 contract, the browser only sends part `PUT` requests to R2, and the API does create, ListParts with pagination, complete and abort itself, because R2 cannot presign POSTs. The API chooses the key `t/{tenant}/quarantine/{upload}/{name}` and the part size (16 MiB, grown to stay within 10,000 parts), stores both with an upload record, signs one part URL at a time for 15 minutes, and refuses a completion unless the parts run from 1 without gaps and every part but the last has the stored size, since MinIO accepts uneven parts that R2 refuses. A lookup by name, size and last-modified time returns the caller's open upload so a reloaded page can resume. A job aborts uploads with no new part for 24 hours, and an R2 lifecycle rule aborts incomplete uploads under the quarantine prefix after 1 day.
  Done when API tests cover the lifecycle, size limits, the equal part size check, ListParts beyond one page, the open upload lookup, the stale upload job, and that tenant B can neither sign, list, complete nor abort tenant A's upload, and INGEST-028 has confirmed the R2 behaviour the routes rely on.
  Depends on STACK-039. Refs `packages/upload-spike`.

- [ ] INGEST-002 · Upload UI with resume
  Drag and drop or file picker on a case, per-file progress, pause, resume after reload, retry on failure, multiple files. The window and its states are INGEST-021.
  Done when an E2E test interrupts a throttled 1 GB upload, reloads the page, and the upload resumes to completion.
  Uses `@uppy/core` and `@uppy/aws-s3` in Companion mode against the INGEST-001 routes, and the throttle is the latency proxy's uplink limit ([ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md)). The spike in `packages/upload-spike` already does this headless.

- [x] INGEST-003 · Ingest workflow skeleton
  Durable workflow per uploaded file: quarantine, scan, identify, validate, index, derive, publish. Each step idempotent, with status visible to the UI.
  Done when a workflow test kills the worker mid-step and the run completes after restart without duplicate outputs.
  Depends on STACK-022. Built on [ADR 0044](adr/0044-background-jobs-and-workflows.md) in `parfocal_common.jobs` ([knowledge/jobs.md](knowledge/jobs.md)). The steps are placeholders until INGEST-004 to INGEST-017.

- [x] INGEST-004 · Format identification
  Magic bytes and TIFF tag inspection to identify vendor and variant, including multi-file formats rejected with a clear message.
  Done when a table test identifies every fixture in the OpenSlide corpus and rejects unsupported formats with a named reason.
  Refs [`poc/scripts/probe-format.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/probe-format.mjs), doc 08.

- [x] INGEST-005 · Malware and integrity scan
  Done when an EICAR test file is rejected and a truncated TIFF fails validation with a user-readable error.
  The owner chose structure checks without an antivirus scanner ([ADR 0081](adr/0081-uploads-are-checked-by-structure.md)).

- [x] INGEST-006 · Pyramid and level validation
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

- [x] INGEST-010 · Thumbnail and overview image
  Done when every fixture produces a thumbnail with correct colours, checked against a golden image.

- [x] INGEST-011 · Label and macro image extraction
  Stored separately under restricted access (SEC-009).
  Done when fixture tests extract them for SVS, NDPI and SCN where present.

- [x] INGEST-012 · Tissue mask
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
  On success the slide becomes viewable in its project and case, paired result files are imported as result sets (RSET-001), and no model runs unless the user started one (JOBS-001).
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

- [ ] INGEST-021 · Upload wizard with slides and results
  Opens from Upload in the top bar, the project page, Home's Start something and a drop anywhere on a project, with a drop overlay. Three steps, Files, Check and Upload, in one full-width wizard whose steps can be clicked once reached ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)). Files has one drop area for slides, result files or a whole folder, and when empty it explains the folder shape that works (a folder is a case, a result sits next to its slide with the same name or in a folder named like the slide). Dropped files are listed grouped by case and slide, with each result file under the slide it was paired with (RSET-004) and how it was paired, an "Add a result file" row per slide and a plain line for slides without results. Results that pair with no slide wait in "Not matched yet" with a slide picker and an Undo after placing. One line says how files were grouped and opens the pairing rule and the case choice (CASES-024). From a link or storage uses the same grouped list. Check shows one zone per problem with its fix (INGEST-022, RSET-005), including a result still not placed, and only Start upload is a filled button. Upload shows one bar for everything and one per file (INGEST-024). Closing keeps the upload going in the jobs tray (JOBS-003). A side summary shows where the files go, the privacy mode and the counts so far.
  Done when component tests cover each step and state, the folder shape help and placing an unmatched result, and E2E drops a folder of slides and results on a project, places an unmatched result on its slide, starts the upload, closes the window and finds the upload in the jobs tray.
  Depends on INGEST-002, INGEST-011, RSET-004, CASES-024. Refs mock: upload, doc 38, doc 39, doc 42, [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] INGEST-022 · Per-file problems in the Check step
  One zone per problem, each with its fix: a slide that cannot be read, an MRXS without its data folder (add the folder), a duplicate already in the project (skip or keep both), and a result file with parse errors, a scale mismatch or new classes (RSET-005). Files with a problem wait and the rest upload. The step counts the open problems down to "Nothing needs you".
  Done when component tests resolve each problem class, and an E2E uploads a mixed set and ends with the fixed files uploaded and the others waiting.
  Depends on INGEST-021, INGEST-018, RSET-005. Refs mock: upload/check, doc 40 R3.

- [ ] INGEST-023 · Idea: What the AI runs, per case
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Running a model is its own window (JOBS-002).
  An upload step that starts each case from the lab's plan for its specimen type (SET-011), for example tumor map then cells in the tumor areas first for a sentinel node, cells on all tissue for a breast biopsy. The doctor can change it for this case only: find tumor areas, find and type cells (where: tumor areas first, all tissue, or only where outlined, at quality Best, Good or Fast), unsure zones (always with the cells) and a second opinion on unsure cells. Options respect each other ("tumor areas first" needs the tumor map) and validation (AIP-005): a model not validated for the specimen is off and locked with the reason, and a stain with no model says so. A side column shows what runs on each slide, the time per slide from measured throughput (AIP-011) or "not measured yet", and the queue with a run-first switch for STAT cases that the lab can audit.
  Done when component tests cover a node case, a biopsy case, an IHC slide, each dependency and the estimate with and without measurements, and E2E starts the plan and sees the jobs created as planned.
  Depends on INGEST-021, AIP-005, AIP-010, SET-011. Refs mock 4 "Choosing what the AI runs", [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] INGEST-024 · Upload progress with steps per slide
  One bar for the whole upload with the time left and one per file. Each file row opens its processing steps: uploaded, tiles built, tissue found, results read, placed on the slide and IDs given, or "no results" for a slide that came without them, with a check per finished step and a bar on the running one. "Open now with what is ready" appears once tissue is found. The last step lists slides without results with Run a model (JOBS-002) or leave them.
  Done when component tests cover running, waiting and finished slides, and E2E opens a slide while its results are still being placed.
  Depends on INGEST-021, RSET-001, OBJ-001. Refs mock: upload/progress, mock: upload/done, doc 39.

- [ ] INGEST-025 · Import slides from a link
  Besides files from the computer, the user can give a link to slides on another server. In v1 that is an HTTPS link or an object-storage link (S3 or Azure, usually presigned). The server, not the browser, reads what the link holds and lists the slides with their size and the project and case each matches (file name or embedded slide ID). It leaves out slides the project already has and downloads the chosen ones into the same quarantine as browser uploads (INGEST-001), so the normal workflow and status follow, and result files next to the slides are imported as result sets (RSET-001). Fetching is protected against server-side request forgery: allowed schemes only, no private or link-local addresses after DNS resolution or redirects, size and time limits, and no platform credentials sent to the link.
  Done when API tests refuse private addresses, redirects to them and oversize files, E2E imports a fixture slide from a test HTTP server into a project, a duplicate is left out by checksum, and the imported slide goes through INGEST-003 to published.
  Depends on INGEST-001, INGEST-003, INGEST-021. Refs mock 4 "From a link", kit W36, kit Flow 7, [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] INGEST-026 · Saved import sources
  Researchers with admin rights save a source once (name, type, address, credentials kept in the secret store), and users pick it when importing. Credentials never reach the browser. In v1 the types are HTTPS and object storage. DICOMweb, SFTP and scanner shares wait for their later epics.
  Done when permission tests restrict editing to researchers with admin rights, a test confirms credentials never appear in API responses or logs, and E2E imports from a saved source.
  Depends on INGEST-025, SEC-013. Refs [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] INGEST-027 · Tissue box that ignores specks
  The tissue mask gets a bounding box computed from its largest connected regions, so a few stray cells near the slide edge do not stretch it to the whole scan. The box is stored with the mask in level-0 pixels.
  Done when tests on CMU-1.svs and CAMELYON16 slides give a box tighter than the all-cells box and still containing more than 98% of annotated tumour.
  Depends on INGEST-012. Refs [ADR 0110](adr/0110-native-jpeg-decode-and-tissue-fit.md).

- [ ] INGEST-028 · Upload protocol check on the R2 dev bucket
  The upload spike ran against MinIO, which differs from R2 in ways that matter. Repeat its protocol checks against the `parfocal-dev` bucket with a per-run prefix that is deleted afterwards: a presigned part `PUT` from the dev app origin with the CORS policy of [ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) and the ETag readable, R2 refusing uneven parts with error 10048, a presigned POST being refused, an expired part URL answering 403 without CORS headers, ListParts over more than one page, the `AbortIncompleteMultipartUpload` lifecycle rule being accepted, and whether parts accept `x-amz-checksum-sha256`. The bucket CORS and lifecycle settings go through `infra/tofu`, and their `tofu apply` needs the owner's yes.
  Done when `packages/upload-spike` runs against `parfocal-dev` at 1 GiB with every check passing or ADR 0116 revised, and a result file records the numbers and the R2 operation count.
  Depends on STACK-039. Refs [ADR 0115](adr/0115-production-access-and-spend-caps.md).

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

- [x] VIEW-000 · Research check for the viewer stack
  Done when STACK-006, STACK-015, STACK-016 are confirmed and the ADR records the Viv and deck.gl versions in use.

### Engine foundation

- [x] VIEW-001 · Engine package API
  Mount and unmount on a container, open slide, set camera, subscribe to camera, events for pointer on slide coordinates, overlay layer registration, dispose.
  Done when unit tests cover the API contract and a mount, unmount and remount cycle leaves no listeners (memory test from VIEW-030).

- [x] VIEW-002 · Viv route on WebGL2 for RGB brightfield
  `MultiscaleImageLayer` or equivalent driven by our PixelSource, with a controlled view state and our own camera controller.
  Done when golden-image tests of fitted, 10× and 40× views on CMU-1.svs match in CI with software rendering.
  Refs [`poc/src/viv/baseline.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/baseline.ts).

- [x] VIEW-003 · PixelSource interface and registry
  One interface for every format. It provides `getTile`, `getRaster`, levels, tile size, microns per pixel, photometric mode, dtype and channel info. Selection by the ingest format id, reading the sidecar index.
  Done when unit tests run the interface conformance suite against every implementation.

- [x] VIEW-004 · Decode worker pool
  Six workers by default (tunable), transferable buffers, priority by distance to viewport centre, cancellation of queued work only, never of completed downloads.
  Done when tests prove late completed chunks are still used. A pan test reproduces the POC fix, with no fetch storm (POC regression: 10,324 fetches and 7.7 GB against a correct 19 and 14 MB).
  Refs doc 06, [`poc/src/viv/plane-pool.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/plane-pool.ts).

- [x] VIEW-005 · Native JPEG decode with per-file validation
  Use `createImageBitmap` for JPEG tiles. At open, decode one tile both natively and through the JS decoder and compare. Fall back per file when they differ (Aperio JPEGTables splicing case).
  Done when the SVS fixture that decodes wrong natively (mean absolute error 47.7) is detected and falls back, with a golden-image test.
  Refs doc 06, [`poc/src/viv/native-jpeg.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/native-jpeg.ts).

- [x] VIEW-006 · Shared decode cache across channels
  Viv requests R, G and B planes separately. One decode serves all three.
  Done when a test counts one decode per tile, not three.
  Refs doc 06, [ADR 0110](adr/0110-native-jpeg-decode-and-tissue-fit.md).

- [ ] VIEW-007 · Interpolation rule
  Nearest at the finest level, linear at coarser levels, half-texel inset to avoid bleeding across tiles.
  Done when golden tests at 40× and above (digital zoom) show crisp pixels and no seams at tile borders.
  Refs doc 06, [ADR 0112](adr/0112-finest-level-sampling-and-webgl-context-recovery.md).
  The owner kept nearest when magnifying and linear when shrinking on 2026-10-31 and asked to compare it with how the POC samples the finest level before ticking.

### Format readers (each is a PixelSource)

- [ ] VIEW-010 · Generic tiled TIFF and SVS JPEG
  Done when CMU-1.svs and generic TIFF fixtures pass the conformance suite and golden images.
  Refs [`poc/src/slide/tiffsource.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/tiffsource.ts), [`poc/src/viv/tiff-source.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/viv/tiff-source.ts).

- [ ] VIEW-011 · SVS JPEG 2000 through OpenJPEG WASM
  Lazy-loaded codec, damaged tile detection with a grey placeholder, no main-thread fallback.
  Done when J2K fixtures pass, a corrupted tile renders grey, and the codec is not downloaded for non-J2K slides.
  Refs [`poc/src/slide/codecs/openjpeg.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/slide/codecs/openjpeg.ts), doc 24, [ADR 0111](adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md).
  The owner kept the grey placeholder on 2026-10-31 and suggested a grey checkerboard instead of flat grey. TODO: decide at the screens stage, because VIEW-041 (how a slide loads) already uses a quiet checker for places where no level has loaded, so the two must not look alike.

- [ ] VIEW-012 · OME-TIFF 8-bit and 16-bit
  Done when the 8-bit and 16-bit multichannel fixtures pass, with 16-bit going through Viv's channel contrast path. Mounting the channel levels in the route belongs to VIEW-018 (multichannel fluorescence display).
  Refs [ADR 0111](adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md).

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
  Done when the 16-bit fixture shows contrast changes within one frame (POC: 16 ms) in a perf test. This includes mounting `createVivChannelLevels` in `createVivRoute` and channel-aware region reads in the decode workers.
  Refs doc 32, [ADR 0111](adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md).

### Camera and interaction

- [x] VIEW-020 · Camera controller
  Pan, zoom to cursor, inertia, zoom limits defined in one place, objective-based zoom presets, fly-to with duration by distance (400 to 700 ms), cancellation by any new input.
  Done when unit tests cover the camera physics and limits, and a test flies between two areas and checks the endpoint.
  Refs [`poc/src/camera/*`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/camera), kit motion spec.

- [ ] VIEW-021 · Wheel, trackpad and pinch handling
  Wheel zooms by default. Pinch is told apart from ctrl+wheel by delta shape. Each event is capped at half an octave. Middle-drag and Space+drag pan in any tool. Settings choose wheel mode, and the default `auto` mode tells a trackpad from a mouse wheel. Shift+wheel pans sideways in pan mode. Double-click zooms in 2× about the cursor and Alt+double-click zooms out 2×, unless the click lands on a shape the active tool edits.
  Done when unit tests replay recorded event traces from a mouse, a Mac trackpad and a Windows precision touchpad.
  Refs doc 16, doc 34 §1.

- [ ] VIEW-022 · Keyboard navigation
  Arrows pan, Shift for 3×, plus and minus zoom by 1.35×, 0 fits, Alt+1 to Alt+6 objective presets. A held arrow pans smoothly, easing up to speed and easing out on release, instead of repeating steps at the key repeat rate.
  Done when tests cover each binding through the key registry (CMD-001).

- [x] VIEW-023 · Touch navigation
  One finger pans, pinch zooms, double tap to 40×, two-finger double tap for the whole slide.
  Done when Playwright touch emulation tests cover each gesture.
  Refs [ADR 0113](adr/0113-interaction-signal-units-and-touch-gestures.md).

- [x] VIEW-024 · Coordinate systems and units
  Level-0 pixels as the canonical space, microns through microns per pixel, screen mapping, and the "digital" label above the scan objective.
  Done when unit tests cover conversions on slides with different microns per pixel.
  Refs [ADR 0113](adr/0113-interaction-signal-units-and-touch-gestures.md).

- [ ] VIEW-025 · Coverage tracking
  Record which tissue has been seen at 10× or more, per user and slide, persisted to the server in batches.
  Done when tests on a scripted pan path produce the expected coverage raster and percentage, and coverage survives reload.
  Refs kit W19, mock 5 and 17.

### Overlays

- [x] VIEW-026 · Overlay layer system
  Typed layers for human annotations, AI proposals, nuclei results, heatmaps, coverage, comment pins and measurements, drawn in a fixed z-order with per-layer visibility and opacity.
  Done when golden tests render each layer type over a slide.
  Refs [ADR 0108](adr/0108-overlay-layers-as-typed-data-over-deck-gl.md).

- [ ] VIEW-027 · Outline rendering with casings
  Class colour outline plus a thin near-black casing, proposals as near-black dashes on a white casing, brightness that never affects overlays.
  The owner kept the VIEW-026 (overlay layer system) placeholder styles on 2026-10-31: fill opacity 0.18 for human annotations, 0.12 for AI proposals, 0.3 for nuclei and 0 for measurements, 2 px lines and 1 px for nuclei, blue open pins and grey resolved pins. Before this task is ticked, compare them with the POC's overlay styles and with published conventions for pathology annotation display, and record where each final value comes from.
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

- [x] VIEW-030 · Memory and teardown correctness
  Destroy the canvas context on dispose, lose the WebGL context, remove every listener, keep one stable `selections` array per slide, upload uint8 as r8unorm, MSAA off, picking off, precomputed polygon indices (built in VIEW-026, [ADR 0108](adr/0108-overlay-layers-as-typed-data-over-deck-gl.md)).
  Done when a CI memory test opens 20 slides in sequence and the heap returns to within 10% of baseline with exactly one Deck alive.
  Refs doc 24.

- [ ] VIEW-031 · luma.gl debug-string cost patch
  luma.gl 9.4.2 no longer builds the sampler debug string, so no patch is needed and the perf test stays as a regression check ([ADR 0098](adr/0098-viv-and-deck-gl-versions.md)).
  Done when a perf test shows no frame over 50 ms during wheel zoom on the Huron fixture.
  Refs doc 24.

- [x] VIEW-032 · Idle means zero work
  No animation loop callbacks when the camera, tiles and overlays are idle.
  Done when a test counts zero rAF callbacks over 10 s of idle and main-thread time under 20 ms per 10 s. The page's own main-thread time is read from a Chrome trace without Chrome's periodic internal tasks (a 5 to 30 ms memory reclaim task runs once per 10 s in every renderer).
  Refs doc 24, [ADR 0109](adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md).

- [x] VIEW-033 · Hidden tab and background scheduling
  A watchdog keeps rendering correct after the tab returns, a camera motion started or running while the tab is hidden settles on its target at once (animation frames are suspended, not throttled, in a hidden tab), a loop generation counter restarts parked loops, and long work is sliced with `scheduler.yield` or MessageChannel.
  Done when a test hides and shows the tab mid-load and the view is complete within 1 s of becoming visible. Headless Chrome cannot be hidden, so the test emulates a hidden tab and a one-off check in headed Chrome is recorded as a result file.
  Refs docs 01, 06, [ADR 0109](adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md).

- [ ] VIEW-034 · GPU error handling
  Error scopes and uncaptured error listeners on WebGPU routes, context loss recovery on WebGL, user-facing message on unrecoverable loss.
  Done when tests force a context loss and the viewer recovers to the same view.
  Refs doc 06, [ADR 0112](adr/0112-finest-level-sampling-and-webgl-context-recovery.md).

- [x] VIEW-035 · Model inference pause during camera motion
  A shared interaction signal that background inference respects. Pause while moving, resume 200 ms after rest.
  Done when the perf test keeps 60 fps while panning during a region pass (POC without pause: 28 to 32 fps). It is measured against a stand-in busy job until the first browser inference task exists, and then repeated with the real region pass.
  Refs [ADR 0113](adr/0113-interaction-signal-units-and-touch-gestures.md), doc 31, [`poc/src/app/interaction.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/interaction.ts).

- [ ] VIEW-041 · How a slide loads
  The coarse level shows first, stretched under the view, and sharper tiles fade in over it without ever showing white or black. A quiet checker in chrome colours marks only places where no level has loaded, and outside the slide bounds the canvas is the plain background. Overlays draw at once over soft tiles and the checker. A hint by the magnification chip ("Loading sharper tiles · 12 left") appears after 1 s of waiting, and after 5 s it names the slow source and how long it answers, with a link to its status. Failed tiles keep the grey placeholder with Retry ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)).
  Done when golden tests show the coarse level under missing tiles, the checker only where no level loaded and the background past the edge, a test with a delayed tile server checks the hint at 1 s and the slow source at 5 s, and no frame shows an empty tile during a fling on the throttled fixture.
  Depends on VIEW-002, VIEW-004, NAV-001. Refs mock: states/loading, mock: states/unloaded, mock: states/slow, doc 42.

### Alternate renderers (developer drawer only)

- [x] VIEW-042 · Camera bounds at the slide edges
  The zoom range follows the slide: out to half the fitted size, in to 16 device pixels per level-0 pixel, both from the one place that holds the limits. The view centre stays on the slide, so the tissue can never be thrown off screen. A coast that hits an edge stops on that axis instead of grinding along it. A resize or a slide switch re-clamps the camera.
  Done when unit tests throw past each edge and check the camera stops there, check the zoom range on slides of different sizes and viewports, and check a resize re-clamps.
  Depends on VIEW-020. Refs [`poc/src/camera/viewport.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/camera/viewport.ts), [`poc/src/camera/camera-controller.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/camera/camera-controller.ts), doc 06 §17, [ADR 0104](adr/0104-camera-controller-motion.md).
- [x] VIEW-043 · Drags that always end
  Pointer capture is attempted but never relied on. `pointerup`, `pointercancel`, `lostpointercapture` and window `blur` all end a gesture, and pointer state lives in one map cleared by any of them. The canvas has `touch-action: none` and `user-select: none`, the page has `overscroll-behavior: none`, and read-only overlays such as the readout have `pointer-events: none`. The cursor shows grab at rest and grabbing while panning. Drags and pinches read `getCoalescedEvents()` where the browser has it, so a fast stroke keeps every sample for the release velocity.
  Done when browser tests release the button outside the viewer, over an overlay, after a lost capture and after a window blur, and the drag ends every time with no pan on the next mouse move.
  Depends on VIEW-020. Refs doc 06 §15, doc 16.
- [ ] VIEW-044 · Prefetch where the view is heading
  Predict the next view from a fast, straight pan or a steady hover and request its tiles at low priority before they enter the view. Velocity is weighted over the last 160 ms with a 55 ms half-life, a path straighter than 0.7 is needed, the lead is 300 ms and at most 1.25 viewports. Prefetch jobs go through the decode pool behind visible tiles and are dropped by its queue rules, never by aborting a download. The developer drawer can turn it off and show the vector.
  Done when a test on a scripted straight pan shows the predicted tiles requested before they enter the view, a zig-zag pan prefetches nothing, and a result file records time to a sharp view at 100 ms RTT with and without prediction.
  Depends on VIEW-004, VIEW-020. Refs [`poc/src/camera/motion-predictor.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/camera/motion-predictor.ts), doc 34 §2.
- [x] VIEW-045 · Camera feel profiles
  Every camera tunable lives in one typed profile that the controller reads live: coast decay and release speed, zoom ease, wheel and pinch rates, the per-event zoom cap, flight duration bounds, keyboard pan speed and the zoom anchor (cursor or view centre). Three presets ship. Smooth is the default with the POC's tuned values, Precise has no coasting and short eases, and Instant turns every motion into a cut. Reduced motion forces Instant. SET-006 (navigation and devices section) maps the settings onto a profile.
  Done when unit tests replay the same scripted input under each preset and check the expected differences, and switching profile mid-motion neither jumps nor leaves a motion running.
  Depends on VIEW-020. Refs [ADR 0104](adr/0104-camera-controller-motion.md), [`poc/src/camera/camera-physics.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/camera/camera-physics.ts).
- [ ] VIEW-046 · Objective detents on wheel zoom
  An optional setting, off by default. A continuous wheel or pinch zoom that crosses 5×, 10×, 20× or 40× holds there briefly, so a pathologist can land on an objective without the keyboard. The hold is released by continuing to zoom, and keyboard and preset zooms ignore it. TODO: the hold length and the zoom distance that releases it need a manual check with a mouse and a trackpad, recorded as a result file.
  Done when unit tests replay mouse and trackpad traces through each detent and check the stop and the release, and a test confirms nothing changes when the setting is off.
  Depends on VIEW-021, VIEW-045.
- [ ] VIEW-047 · View history
  Jumps (fly-to, presets, fit, minimap clicks, area and object navigation) record the view they left. Continuous pans and zooms count as one entry once the camera rests. Back and forward keys from the key registry move through the last 50 views with a fly-to, and the history is per slide and cleared on a slide switch.
  Done when unit tests cover recording, coalescing a pan into one entry, back and forward, and the cap, and a browser test goes back after a minimap jump and lands on the old view.
  Depends on VIEW-020, CMD-001.
- [x] VIEW-048 · Open fitted to the tissue
  A slide opens fitted to the bounding box of its tissue mask with a small margin instead of the whole scan with its empty glass. `0` and the fit command use the same box. Without a mask the whole slide is fitted.
  Done when unit tests fit a slide with and without a mask, and a golden test opens a CMU-1.svs fixture with a mask fitted to its tissue.
  Depends on VIEW-020, INGEST-012. Refs [ADR 0110](adr/0110-native-jpeg-decode-and-tissue-fit.md).
- [ ] VIEW-049 · Deliver the tissue box to the viewer
  The tissue box that VIEW-048 (open fitted to the tissue) reads reaches the viewer with the slide, from the slide index or the slide record, instead of being passed by hand. A slide without a stored mask opens fitted to the whole scan.
  Done when a test opens a slide through the real opener and the camera is fitted to the stored box, and a slide with no box opens fitted to the whole scan.
  Depends on VIEW-048, INGEST-007. Refs [ADR 0110](adr/0110-native-jpeg-decode-and-tissue-fit.md).
- [ ] VIEW-050 · Polygons with holes in overlay batches
  Overlay polygon batches accept rings with holes. The triangulation, the outline loops and the precomputed indices all follow the holes.
  Done when a golden test renders a polygon with a hole and an island inside the hole, and unit tests check the triangle count and that no triangle covers the hole.
  Depends on VIEW-026. Refs [ADR 0108](adr/0108-overlay-layers-as-typed-data-over-deck-gl.md).
- [ ] VIEW-051 · Triangulate large result sets off the main thread
  A polygon batch of a large result set is triangulated in a worker or comes with its indices from the server, so a 1M polygon layer does not block the page for 273 ms.
  Done when a test shows the longest main-thread task while a 1M polygon batch is prepared stays under 50 ms and the pixels match the main-thread batch.
  Depends on VIEW-026. Refs [ADR 0108](adr/0108-overlay-layers-as-typed-data-over-deck-gl.md), [result](results/2026-10-25-overlay-polygon-indices.md).
- [ ] VIEW-052 · Hidden tab check in headed Chrome
  Run the hidden-tab loading test by hand in headed Chrome on the owner's Mac, with a real tab switch, and record how long the view takes to complete after the tab returns.
  Done when a result file records the run, including a real context loss and restore while the tab is hidden and a run on a hardware GPU, with the Chrome version, the slide, the RTT and the times, next to the emulated numbers.
  Depends on VIEW-033. Refs [ADR 0109](adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md), [result](results/2026-10-25-idle-and-hidden-tab.md).
- [ ] VIEW-053 · Touch tap values on real hardware
  Try the double tap to 40x and the two-finger double tap on a real tablet and a touchscreen laptop, and tune `touchTuning` (tap slop 10 px, tap length 300 ms, double-tap window 350 ms and 40 px) from what feels right.
  Done when a result file records the devices, the values tried and the values kept.
  Depends on VIEW-023. Refs [ADR 0113](adr/0113-interaction-signal-units-and-touch-gestures.md).
- [ ] VIEW-054 · JPEG 2000 slide in the viewer fixture group
  The real JPEG 2000 goldens and the CMU-1.tiff golden run in browser CI, which needs `CMU-1-JP2K-33005.svs` (132,565,343 bytes) and `CMU-1.tiff` (204,117,846 bytes) in the `viewer` fixture group and its CI cache.
  Done when the `browser` CI job fetches them under the cache key and the goldens run instead of skipping.
  Depends on VIEW-011. Refs [ADR 0111](adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md).
  The owner chose on 2026-10-31 to add both slides, about 510 MB for the whole group.
- [ ] VIEW-055 · JPEG 2000 coarse level differences from OpenSlide
  On JP2K-33003-1.svs and JP2K-33003-2.svs one tile at each of levels 1 and 2 differs from OpenSlide by up to 47 while level 0 is within 0.5. Find out whether the cause is the reference, the level table or the decoder.
  Done when a result file names the cause and a test pins it.
  Depends on VIEW-011. Refs [result](results/2026-10-26-jpeg-2000-in-the-decode-workers.md).
- [ ] VIEW-036 · Renderer interface and route switching
  One interface implemented by Viv (primary), deck.gl 9.4 WebGPU and the custom WebGPU engine. Switching remounts cleanly and keeps the camera.
  Done when the same golden tests pass on all three routes for 8-bit RGB slides and switching 10 times passes the memory test.
  Refs [`poc/src/app/renderer.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/app/renderer.ts).

- [ ] VIEW-037 · deck.gl 9.4 WebGPU route
  TileLayer over BitmapLayer from the same PixelSources, SolidPolygonLayer for outlines, with known gotchas handled (redraw with a reason, minZoom, adapter limits for buffer size).
  Done when golden and perf tests pass, with uncaptured errors counted and zero. The error helpers are in `src/viv/webgpu-errors.ts` ([ADR 0112](adr/0112-finest-level-sampling-and-webgl-context-recovery.md)).
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
  Refs mock 20, kit W25.

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
  Product tokens from the kit for dark and light: page, chrome, chrome-2, chrome-3, canvas, line, line-strong, fg, fg-dim, fg-faint, accent, accent-fill, accent-soft, on-accent, ok, warn, bad, future, pin, plus class colours, the proposal colour and `unsure` (#cbd5e1 dark, #475569 light, used as a hatch or with a pattern, never as a fill alone). Spacing on a 4 px grid, radii 4, 7 and 10. Exported as CSS variables and TS constants.
  Done when unit tests assert every token exists in both themes and a visual test renders the specimen page.
  Refs kit Design system page, mock token block, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] DS-002 · Colour measurement scripts in CI
  WCAG 2 contrast and APCA Lc 60 or more for every text pair, CIEDE2000 between classes after protan, deutan and tritan simulation (Machado), outline contrast over sampled real H&E pixels. Start from the POC's `scripts/color-check.mjs`, which already implements all four.
  Done when CI fails if a token change breaks any threshold, with the doc 35 numbers as the baseline (closest class pair 15.1 under deuteranopia, proposals at least 40 from every class, unsure marks at least 13 from every class on the slide and 15 in the panel).
  Refs doc 35, kit decision D12, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md). Use the limits that the API applies to class colours ([ADR 0067](adr/0067-class-taxonomy-and-colour-check.md)) so tokens and taxonomies never disagree.

- [ ] DS-003 · Typography
  IBM Plex Sans and IBM Plex Mono, self-hosted. Nine sizes and nothing between them: label 11/600 in capitals, caption 12, body small 13, body 14, lead 16, title small 18/600, title 20/600, page title 24/600 and display 28/600. Running text is never under 12 px, and 11 px is only for capital labels, tags, counts and keycaps. Mono only for IDs, numbers in columns, file names and keys.
  Done when the type specimen story passes visual tests, fonts load without layout shift, and a lint check fails on a font size off the scale.
  Refs doc 41, kit: UI kit: tags, icons and type, doc 40 D5.

- [ ] DS-004 · Icon set with key badges
  The SVG icon set from the mock (select, hand, smart, auto, poly, free, rect, ellipse, marker, ruler, arrow, text, comment, brush, slides, sun, gear, help, share, back, next, popout, device icons, panel, home, check, warn, eye, lock, search, flag and others) as React components. Five sizes: 12 inside tags and checkboxes, 16 by default, 20 for sidebar navigation, large buttons, tiles and zone headers, 24 for drop zones and empty states, and 40 for state badges. Icons take the text colour, the accent only for a selected state and a status colour only when the icon is the status. One stroke width. Tools show their key in the tooltip.
  Done when every icon has a story and an accessible name, and a test fails on an icon size off the scale.
  Refs doc 41, doc 40 D4.

- [ ] DS-005 · Theme switching
  System, dark and light, with the user setting stored per device. Neutral chroma near zero for chrome.
  Done when visual tests cover both themes for every component.

- [ ] DS-006 · Buttons and icon buttons
  Primary, secondary, ghost. One filled primary button per screen, so the top bar's Upload is a normal button (doc 40 D2). States are default, hover, pressed, focus and disabled. Inline key hints. 32 px height, 24 px minimum target.
  Done when stories, interaction tests and axe pass.

- [ ] DS-007 · Segmented control, toggle, slider, stepper
  A segmented control for 2 to 4 short options, a select for more, and plain radio rows with a sentence when an option needs one. No bordered radio or checkbox cards. The chosen segment has the accent fill and an accent ring (doc 39, doc 40 D1).
  Done when stories, keyboard tests and axe pass.

- [ ] DS-008 · Tags
  Nine tag types cover the app. Status is round with a dot and a word, in the tones neutral, accent, ok, warn, bad and research. Category has square corners, is gray and may carry a 12 px icon. Object ID is monospace with a border, at 20 px and 28 px. Result set has a layers icon and a tone by its source. Count is 16 px, blue when it needs the person and gray for totals. Keycap (DS-009), token (DS-020) and filter chip, a control with a check when on, complete the set, with mock-only markers kept out of the product. Tags are 20 px, never clickable, in sentence case, and a status always has its dot and a word.
  Done when stories exist for every type and tone in both themes, and a test fails on a tag height or tone outside the set.
  Refs doc 41, kit: UI kit: tags, icons and type, doc 40 D3, [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] DS-009 · Keycap component
  Done when keycaps render the user's current binding from the key registry, not a hard-coded letter.

- [ ] DS-010 · Tool rail button
  38 px, key badge, active state, AI dot.
  Done when stories and tests cover each state.

- [ ] DS-011 · Popover, dialog, menu, tooltip, toast
  Toasts last 1.6 s by default and never cover the slide centre.
  Done when focus trapping, Esc handling and axe tests pass.

- [ ] DS-012 · Inspector primitives
  Section label, card, warn bar, region row with size and category tag, class bars, staging hero with the log size scale, count bar with the 200 line, step block ("1 · Is it tumor?") and the done state of a step, zone row with its pin, number line with sure and unsure parts, cell crop, and the back link with its key.
  Done when stories render the mock 6 data and a unit test checks the range bar geometry.

- [ ] DS-013 · Gallery tile
  92 px and 120 px sizes. States are to check, current, done. Dashed ring on the cell, label in AI wording.
  Done when stories and tests cover each state.

- [ ] DS-014 · Avatar, avatar stack, presence dot
  A person is always an avatar with a name. A stack shows the names in a tooltip and a +N count (doc 38).
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

- [ ] DS-018 · Surfaces and zones
  Three surface levels and one highlight: the page, a panel or modal body one step up, a section inside it one more step up, and the accent tint for the part that needs attention now. Information is split into zones by background, with 8 to 12 px inside a zone, 24 to 32 px between zones and at least 24 px of modal padding.
  Done when stories show each level in both themes and a visual test covers a modal with three zones.
  Refs doc 38 "Surfaces and spacing".

- [ ] DS-019 · Progress bar and ring
  One thin bar for files, jobs and tasks with the label on the left and the value or time left on the right, and one ring for review progress split by verdict colour (agree, disagree, not sure, open) with the percentage in the middle.
  Done when stories cover each state, a unit test checks the ring arcs add up, and the bar and ring expose progressbar and image roles with their values.
  Refs doc 38 "One component per job".

- [ ] DS-020 · Type-to-find token field
  A field where a person types a name or a slide, a list shows matches with avatar, name and role or a thumbnail, and picked items sit in the field as chips with a remove cross. It also offers to invite an email that matches nobody.
  Done when component tests cover typing, picking by keyboard, removing and inviting, and axe passes.
  Refs doc 39, mock: task/find.

- [ ] DS-021 · Undo toast
  A toast that names what just happened ("T1 marked agree", "Run cancelled") with an Undo link, kept for 4 s and not covering the slide centre. Undo restores the exact state before the action.
  Done when component tests cover undo within and after the window, and E2E undoes a verdict and a cancelled run.
  Refs doc 40 G2 and R1, doc 41.

- [ ] DS-022 · Modals: small one-column and full-width wizard
  Small one-column modals for short tasks and a medium one-column stepper (New review task) that sizes to its content, with a shadow over the footer when more content follows. Only the upload wizard is full width. Steps of a stepper can be clicked to go back. The scrim is 62% black in dark.
  Done when stories cover each size, a test switches steps without the width changing, and focus trapping and Esc pass.
  Refs doc 39, doc 40 R3 and R4.

---

## 09 SHELL · Application shell and layout

- [ ] SHELL-000 · Research check
  Done when STACK-003 and STACK-005 are confirmed for the shell.

- [ ] SHELL-001 · Routes and code splitting
  Home, My work (with its tab), project (with tab and filters), slide (with project, task, slide, camera and selected object in the URL), guided review, evaluation report, setup, settings deep links and admin as its own page. The viewer engine is split into its own chunk.
  Done when routing tests cover deep links and the initial home bundle stays under the budget set in TEST-006.

- [ ] SHELL-002 · Global top bar and sidebar
  One top bar outside a slide, with the Parfocal logo and the workspace's name and logo with its switcher (IAM-008), search that opens the palette and accepts object IDs, New project, Upload as a normal button, the jobs ring (JOBS-003), the bell (NOTIF-002) and the account menu (SHELL-012). The sidebar holds Home, My work with its count, the projects with their slide counts, New project and, for admins, Admin under Workspace. Mentions live only behind the bell. Settings and theme are reached through the account menu and Cmd+comma.
  Done when component and E2E tests cover each control, every control is reachable by keyboard, and a test confirms the sidebar has no Mentions entry.
  Refs mock: home, doc 39, doc 41, [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] SHELL-003 · Slide top bar
  A quiet bar: icon-only back, the slide picker (thumbnail, slide, case, n of N and a count of result sets per slide) that opens the slides popover (CASE-002), the Guided, Full viewer and Annotate switch, the progress ring (CASE-015), the panel toggle, a more menu (share, add a result set, run a model, compare, focus mode, shortcuts, settings) and Submit review as the primary button for reviewers. Popovers close on Esc and on an outside click.
  Done when component tests cover each element and each popover, and E2E covers keyboard access to all of them.
  Refs mock: case, doc 38 "Viewer".

- [ ] SHELL-004 · Workspaces Review and Annotate
  Guided review (GUIDE-002), Review and Annotate save to one review. Switching between Review and Annotate changes the rail, the drag behaviour (pan in Review, marquee in Annotate) and the inspector defaults, without moving the slide.
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
  My work to slide (the row grows into the canvas), tile to focus review, submit back to My work. Built on the View Transitions API, with a new key press cancelling the current transition.
  Done when tests confirm input is never blocked during a transition and reduced motion cuts.
  Refs kit motion table.

- [ ] SHELL-008 · Focus mode
  Cmd+\ hides the top bar, rail and inspector, shows the focus pill and the area card, keeps the minimap and magnification bar.
  Done when E2E covers enter and exit and the screen-coverage measurement drops to the expected value.
  Refs mock 16, kit W23.

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
  Refs doc 35, mock 7 pop-out icon.

- [ ] SHELL-012 · Account menu
  Opens from the user's avatar wherever the global bar shows. It holds the user's name and role, availability status (IAM-015), theme (DS-005), initials only (WL-013), settings, keyboard shortcuts (CMD-003), profile and signature (SET-010), help and what's new, and log out. Theme and initials only apply at once. Log out ends the session, keeps unsaved drafts, and is never worded like signing out a case.
  Done when component tests cover each item, axe passes, keyboard users reach every item, and E2E logs out and back in with a draft intact.
  Depends on IAM-002, IAM-015. Refs mock 1, kit W35, [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

---

## 10 HOME · Home

The launchpad is everyone's home ([ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md), [ADR 0053](adr/0053-ai-results-review-direction.md)). The department dashboard is an idea. The feed and search-first ideas live on as the launchpad's activity, the bell and the search page.

- [x] HOME-000 · Research check
  Done when the data each variant needs is mapped to API endpoints in an ADR.
  Refs [ADR 0085](adr/0085-home-aggregate-api.md).

- [x] HOME-001 · Home API aggregates
  Resume target (task, slide, object, camera), the user's tasks with due dates, projects with a strip of slide thumbnails and review progress, the week in numbers (objects checked, share agreeing with the AI, open disagreements), what is coming up and announcements, as one `GET /api/me/home`.
  Done when API tests cover each aggregate with tenant isolation.
  Depends on HOME-000, HOME-011. Refs [ADR 0085](adr/0085-home-aggregate-api.md).

- [ ] HOME-002 · Launchpad home
  A greeting with the date and what is due, then a large continue card with the slide image, the task, slide n of N, progress and the due date, with Continue and Open in the full viewer. Start something tiles with one line each (Upload, Run a model, New review task, Find an object, New project), the projects as cards with a strip of their slides and review dots, and a side column with the week in numbers, coming up and announcements. A first-week variant leads with the sample project and the getting-started checklist (ONB-006).
  Done when component tests cover each block with seeded data and E2E continues at the exact saved slide and object.
  Refs mock: home, doc 39, [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] HOME-003 · Resume state
  Persist the last task, slide, camera, mode, selected object and review position per user. The home aggregate prefers the stored state when it is newer than the review activity it derives the resume target from ([ADR 0085](adr/0085-home-aggregate-api.md)).
  Done when E2E closes the browser mid-review and resumes at the same object.

- [ ] HOME-004 · Idea: Variant B Department dashboard
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Today, week and month toggle. KPIs for received, AI pre-read share, median turnaround against target, STAT open, second opinions. Pipeline funnel, team load with rebalance suggestion, turnaround chart, needs-attention list.
  Done when component tests render seeded data and permission tests restrict it to lab leads and admins.

- [ ] HOME-005 · Idea: Department metrics pipeline
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Turnaround, throughput and funnel computed from case and job events.
  Done when unit tests compute metrics from a seeded event log.

- [ ] HOME-006 · Idea: Rebalance suggestion
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Suggest moving cases between pathologists by load and specialty. The suggestion only proposes, and a lead confirms.
  Done when unit tests cover the heuristic and E2E applies a suggestion with an audit entry.

- [ ] HOME-007 · Activity on the launchpad and in notifications
  Replies, mentions, new tasks, finished model runs and imports, and sign-offs, shown on the launchpad and in the notification centre, filterable by everything, mentions and jobs. Each item links to the slide, object, thread, task or job.
  Done when component tests render seeded events with each filter and the activity updates in realtime.
  Depends on COLLAB-001, NOTIF-002. Refs mock 1 scene C, [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] HOME-008 · Search page
  A full search page reached from the sidebar and from the palette's "all results", with scopes (all, projects, cases, slides, object IDs, people, actions), grouped results, and an ID result that opens the slide at the object.
  Done when E2E searches `T2·C145` and part of a full path and opens the slide at the object.
  Depends on CASES-009, CMD-002. Refs mock 1 scene D, [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] HOME-009 · Announcements
  Researchers with admin rights post announcements, shown on Home with a coloured dot by kind (a new model, a slow server, a change).
  Done when component tests cover create, list and expiry.
  Depends on HOME-011. The API moved to HOME-011 by [ADR 0085](adr/0085-home-aggregate-api.md).

- [ ] HOME-010 · Role-based default home
  The launchpad for everyone. A reviewer's continue card and tasks come first, a researcher's projects and Start something come first, set from the role chosen at setup (ONB-004) and changeable in settings.
  Done when tests cover defaults per role and the override.

- [x] HOME-011 · Announcements API
  Workspace admins post announcements with a kind (`model`, `slowdown`, `change`), a text and an optional end time, end them early, and members list the current ones newest first.
  Done when API tests cover create, list, ending early and expiry, with permission and tenant isolation tests.
  Depends on IAM-004. Split from HOME-009 by [ADR 0085](adr/0085-home-aggregate-api.md).

---

## 11 WL · My work

My work replaces the worklist ([ADR 0053](adr/0053-ai-results-review-direction.md)). To review lists the reviewer's tasks behind one Continue card, Assigned by me shows the researcher's tasks with progress per reviewer, and All slides is a filterable table. The worklist views, the case preview and the AI queue are ideas.

- [x] WL-000 · Research check
  Done when the My work query API and the data needs of its three tabs are captured in an ADR.
  Decided in [ADR 0082](adr/0082-my-work-query-api.md).

- [x] WL-001 · My work query API
  Tasks for me with my progress and due date, tasks I created with progress per reviewer and their status (in review, not started, disagreements, ready to sign off), and all slides I can see with project, result sets, reviews and status. Filters by project, status, result set and reviewer, and a label search. Cursor pagination. The storage filter moved to REMOTE-001 ([ADR 0082](adr/0082-my-work-query-api.md)).
  Done when API tests cover every filter and tenant isolation.

- [ ] WL-002 · Worklist sidebar (moved)
  Moved to SHELL-002, which holds the sidebar ([ADR 0053](adr/0053-ai-results-review-direction.md)).

- [ ] WL-003 · Idea: AI status line
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  The segmented bar and the sentence "The AI has read 6 of 8 cases ...", with a link to the queue.
  Done when component tests cover every AI state mix.

- [ ] WL-004 · Idea: AI cell and dot semantics
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Dot colours and one-sentence AI result per case. Red means tumor flagged, green nothing flagged, blue reading, amber decision needed, grey no model applies. Progress bar while running.
  Done when unit tests map every case AI state to its dot and sentence.
  Refs mock 2 caption.

- [ ] WL-005 · To review tab
  One Continue card for the task in progress with the slide image, progress and time left, then each of my tasks with its project, scope, due date, blinding, my progress and a status tag, with Continue or Start. A side column shows mentions and replies. Opening the next slide is one action.
  Done when component tests cover a task in progress, a new task and a finished one, and E2E continues from My work into guided review at the next object.
  Refs mock: worklist/review.

- [ ] WL-006 · Keyboard navigation in the worklist
  Arrow keys and J and K move the selection in each tab, Enter opens the task or slide and Esc clears the selection.
  Done when E2E drives the whole list by keyboard.

- [ ] WL-007 · Idea: Case preview on demand
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Selecting a case shows a preview next to the list without leaving it: the slide with the AI map faintly over it, the AI result and how sure it is, the case's slides, specimen, clinical note, due time, status and who else is on the case, and open lab work (BOARD-001). From the preview the user can open the case, reassign it (BOARD-007) and open its ticket on the board. The preview never shows until asked for, the list stays usable while it is open, and whether it opens on select is remembered per user.
  Done when component tests cover a ready, a running and a not-run case, E2E selects by keyboard and opens by Enter, and the remembered choice survives a reload.
  Refs mock 2 scene "A with B's preview open", [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] WL-008 · View C Status board (dropped)
  Dropped. The status board is a page of its own, see the BOARD epic ([ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md)).

- [ ] WL-009 · Idea: View D Day plan
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Timeline 9:00 to 16:00 with a now line, cases placed by due time and estimated reading time, fixed commitments, unscheduled list, re-plan.
  Done when unit tests cover the estimate (slide count, specimen, AI pre-read) and the placement algorithm.

- [ ] WL-010 · Idea: Reading-time estimate model
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A simple estimate from slide count, specimen type and AI result, calibrated later from task timing (EXP-006).
  Done when unit tests cover the formula and it is versioned.

- [ ] WL-011 · Idea: View E Slide grid
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Card per case with thumbnail and faint AI map, progress ring and time left while running.
  Done when component tests cover ready, running and queued cards.

- [ ] WL-012 · Idea: View switcher and persistence
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  List, day and grid views and the case preview on demand, remembered per user, overridden by experiment assignment when one is active.
  Done when tests cover persistence and experiment override.

- [ ] WL-013 · Hide names
  Swap names for initials across the app for screen sharing and teaching.
  Done when E2E confirms no full name appears anywhere in the DOM with the toggle on.

- [ ] WL-014 · Idea: AI queue panel
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. The jobs tray (JOBS-003) replaces it.
  Jobs per slide in run order, stage pills (scan, tissue, tumor map, cells), ETA, throughput sparkline, held job with run anyway or skip AI, pause queue, run STAT first.
  Done when component tests cover every job state and action shown in the mock 2 queue scene, and API tests cover each action with permissions.
  Depends on AIP-010.

- [ ] WL-015 · Idea: Star and assign
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Star a case, and assign it to yourself from the list. Reassigning to someone else goes through the picker in BOARD-007.
  Done when API and E2E tests cover each action with audit entries.

- [ ] WL-016 · Realtime worklist updates
  New tasks, reviewer progress, finished jobs and status changes update without reload.
  Done when E2E with two sessions shows an update within 2 s.
  Depends on COLLAB-001.

- [ ] WL-017 · Filter popover
  Project, status, result set and reviewer, for the All slides tab, kept in the URL. Storage joins with REMOTE-001 ([ADR 0082](adr/0082-my-work-query-api.md)).
  Done when component tests cover combined filters and URL persistence.

- [ ] WL-018 · Assigned by me tab
  The researcher's tasks as a table with the result set, each reviewer as avatar and name with a progress bar, the due date, a status tag and one action by status: Nudge, Resolve for disagreements or Sign off when ready. A more menu reassigns slides, changes the due date or adds a reviewer (TASK-007).
  Done when component tests cover each status and its action, and E2E nudges a reviewer and opens the disagreement queue.
  Depends on WL-001, TASK-007. Refs mock: worklist/assigned.

- [ ] WL-019 · All slides tab
  Every slide the person can see, with project and case, result sets, reviews by person and status, a search that filters as you type and the filters of WL-017. A row opens the slide.
  Done when component tests cover the filters and the search, and the table virtualises 10,000 rows.
  Depends on WL-001, WL-017. Refs mock: worklist/all.

---

## 12 CASE · Slide view

The case view becomes the slide view ([ADR 0053](adr/0053-ai-results-review-direction.md)). The inspector has Objects, Layers, Comments and Opinion tabs (CASE-014). Sentinel-node staging is a project analysis template (PROJ-005), so the staging tasks here and in REVIEW apply only in projects that turn it on.

- [ ] CASE-000 · Research check
  Done when the case view state model (slide, workspace, inspector tab, area, review position) is captured in an ADR.

- [ ] CASE-001 · Case loader
  Load the project, the optional case, the slides, their result sets, the review task and the person's verdicts, and open the slide fitted. Patient fields load only in clinical projects.
  Done when E2E opens a slide from My work and from the project page and the slide is fitted within the TEST-006 budget.

- [ ] CASE-002 · Slides popover
  The top bar's slide button opens the case's slides with thumbnail, case, block and stain, the number of result sets, review progress and processing progress. Q and E step through slides. Every other slide has a "Side by side" button (CMP-007), and the footer has "Compare slides" and "Add slides" (INGEST-021). The permanent tray is an optional pinned strip in settings, off by default.
  Done when tests cover switching from the popover and by key, switching preserves per-slide camera, and the pinned strip setting works.
  Refs mock 5, kit W33, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] CASE-003 · Per-slide view memory
  Each slide remembers its camera while the case is open.
  Done when tests switch slides and come back to the same view.

- [ ] CASE-004 · AI state: pre-read ready
  Heat overlay and area outlines with numbered badges. The panel leads with the staging question for a sentinel node: "Metastasis likely, largest about 7.7 mm", a chip "Macro if confirmed", and a size scale with the 0.2 and 2 mm lines (REVIEW-004). The area list is largest first with size and category per row. The footer says "Start with area 1". Once the largest area is confirmed and measured the hero reads "Macrometastasis, 8.0 mm, settled" with the suggested pN stage, the smaller rows say they cannot change the category, and the footer offers submit.
  Done when component tests cover the content and behaviour of the mock 5 "Large deposit found" scene in both the open and the settled state.
  Refs kit W2, doc 36, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).
  Only in projects with the sentinel node staging template (PROJ-005).

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

- [ ] CASE-008 · Idea: AI state: model not validated
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. It depends on per-specimen validation, which is an idea.
  Warning bar, areas shown for reference only, no verdict, amber chip.
  Done when component tests cover the state and the report draft notes it.
  Depends on AIP-005.

- [ ] CASE-009 · Viewed ring
  Share of tissue seen at 10× or more, in the top bar, opens peek on click.
  Done when tests check it against the coverage raster.

- [ ] CASE-010 · Patient banner
  Only in clinical projects (PROJ-002). A lab-locked setting that keeps name, sex, age and record number visible on every case screen.
  Done when tests cover the setting and initials mode.

- [ ] CASE-011 · Case header details
  Project, case, specimen, blocks, the task and its researcher, and in clinical projects the clinical note, in the slide picker's details (SHELL-003).
  Done when component tests cover each field and missing data.

- [ ] CASE-012 · Idea: Case state transitions
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Review tasks carry the slide pipeline (TASK-002), and ADAPT-007 reverts the case state machine.
  Scanned, AI reading, to review, waiting on others, draft report, signed, amended.
  Done when unit tests cover the state machine and every transition is audited.

- [ ] CASE-013 · AI state: only a small cluster
  When the largest area sits near 0.2 mm, the hero says both its size and its tumor cell count decide between isolated tumor cells and a micrometastasis, and lists the steps still open (confirm, measure, count cells).
  Done when component tests cover the content and behaviour of the mock 5 "Only a small cluster" scene and the step list follows the staging state.
  Depends on REVIEW-003. Refs doc 36, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).
  Only in projects with the sentinel node staging template (PROJ-005).

- [ ] CASE-014 · Inspector with Objects, Layers, Comments and Opinion
  Four tabs with counts. Objects lists the object IDs with their verdicts and, with the staging template, the staging hero and area list. Layers holds the result sets and their styles (VIZ-001). Comments lists the threads by ID (COLLAB-005). Opinion holds the form (GUIDE-007). The template line names the project's analysis template.
  Done when component tests cover each tab with seeded data, the counts follow changes, and a project without a template shows no staging.
  Depends on CASE-001, OBJ-001, GUIDE-001. Refs mock: case, mock: layers, doc 37 "Viewer".

- [ ] CASE-015 · Progress ring in the slide top bar
  One ring split by verdict colour (agree, disagree, not sure, open) with this slide's percentage. Clicking it opens a popover with the task, slide n of N, the due date, time left and a button for the next slide.
  Done when component tests cover an empty, a partial and a finished slide, and E2E opens the next slide from the popover.
  Depends on DS-019, TASK-003. Refs doc 38 answer 3, mock: case.

---

## 13 NAV · Navigation aids

- [ ] NAV-000 · Research check
  Done when the minimap state machine and placement algorithm are written as an ADR from kit and mock specs.

- [ ] NAV-001 · Magnification bar
  Presets 1.25×, 2.5×, 5×, 10×, 20×, 40× with Alt+1 to Alt+6, nearest preset highlighted, option to label as zoom percent. Folded by default to a chip with the magnification and the scale bar, opening to the presets, readout and brightness on hover and focus, while Alt plus a number is held, for 2 s after a zoom and while the brightness popover is open. Brightness shows when folded only if it is not 100%. No animation under reduced motion. Overlays that keep clear of the bar use its current size ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)).
  Done when tests cover preset jumps, highlighting at intermediate zooms, each way the chip opens and folds back, and the blocked area in both states.
  Refs mock §2.6.

- [ ] NAV-002 · Scale bar and readout
  Nice values from 10 µm to 5 mm, mm at 1000 µm and above, readout with objective and microns per pixel, "digital" above the scan objective.
  Done when unit tests cover the scale bar choice at every zoom.

- [ ] NAV-003 · Slide brightness dial
  Popover with slider from 20 to 140%, Alt+Up, Alt+Down, Alt+0 reset. Affects the slide only, never the UI or overlays. Remembered per device. Accent colour when not 100%.
  Done when golden tests confirm only slide pixels change and overlays keep their colour.
  Refs mock §2.7, kit D11.

- [ ] NAV-004 · Area list and go to area
  Areas sorted by size with real dimensions and category (macro, micro, ITC size), G then n flies to area n, `[` and `]` go to previous and next. Each row says its role: "Largest, sets the category" for the lead area and, once the category is settled, "Can't change the category" for the others.
  Done when E2E flies to each area and marks it visited at 10× or more.

- [ ] NAV-005 · Edge cues
  Pills at the screen edge pointing to off-screen areas with their distance, clickable to fly there.
  Done when unit tests cover cue placement and distance, and E2E clicks a cue.
  Refs mock §2.8, NaviPath evidence.

- [ ] NAV-006 · Smart minimap state machine
  States hidden, reading, area, locator, travel, faded and peek, with the transitions from the kit spec (hidden while more than half the tissue is on screen, area mapping from 20×, locator in focus review, travel on `]` or G+n, faded within 40 px of the pointer).
  Done when model-based tests drive every transition.
  Refs kit Interaction spec, mock 7. Built on STACK-005 state machine choice.

- [ ] NAV-007 · Minimap placement scoring
  Score each corner by preference plus weighted hot points under it (tumor edge, measurement, current cell, doubtful cells, proposals, pins) plus blocks for chrome. The lowest score wins, ties go to bottom right. Move with a 300 ms ease, never while panning.
  Done when unit tests reproduce the mock's placement decisions for each scene.
  Refs mock 7 placement algorithm.

- [ ] NAV-008 · Minimap content
  Seen trail, area outlines with badges, viewport rectangle (crosshair below 8 px), cell dots in area mode, header and footer text. The map is a button: a click opens the whole-slide peek (NAV-010), with a corner "open" hint and a hover ring. Dragging the viewport rectangle still moves the view.
  Done when golden tests cover reading, area and travel modes and E2E opens the peek by clicking the map.
  Refs [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] NAV-009 · Minimap settings
  When useful, always, never.
  Done when tests cover each mode.

- [ ] NAV-010 · Whole-slide peek
  Hold Z for the whole slide over a dimmed case and release to return. A tap under 350 ms keeps it open until Z, Esc or a click. It also opens from the viewed ring and from a click on the minimap. Click a place to go there. Seen trail, AI areas, checked ticks, you-are-here box, and a "return" hint while latched.
  Done when E2E covers hold, tap-to-latch, opening from the ring and the minimap, click-to-go and release.
  Superseded behaviour: the earlier "tap toggles the last two magnifications" is dropped, see [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).
  Refs mock 17, kit W12.

- [ ] NAV-011 · Travel animation and route line
  Camera flight with a route line to the target, skip with `]` again.
  Done when tests confirm a new key press cancels the flight at its current position.

- [ ] NAV-012 · Zoom to selection
  Shift+2 zooms to the selected shape or area.
  Done when a test confirms the selection is fitted with margin.

---

## 14 REVIEW · Review workspace

Cell findings and node staging run in the Objects tab of the slide view (CASE-014). Verdicts on whole objects come from GUIDE-001 and use K, X and U in both modes ([ADR 0053](adr/0053-ai-results-review-direction.md)). Node staging applies only with the sentinel node template (PROJ-005).

- [ ] REVIEW-000 · Research check
  Re-read docs 28 and 33 and confirm the confidence rules below still hold for the typer chosen in AINUC.
  Done when an ADR lists the display rules and their evidence.

- [ ] REVIEW-001 · Review rail
  Five tools: select V, hand H, ruler L, comment C, smart select S (routes to Annotate).
  Done when component tests cover each tool and routing.

- [ ] REVIEW-002 · Findings tab layout
  Two layouts, chosen by the specimen. Cell findings, the default: the panel shows only what is selected. With nothing selected, one number line (REVIEW-005) for the slide and the zones where the AI is unsure (REVIEW-018), most unsure first, then the scattered unsure cells, a drawn outline and the "Changed after your corrections" zone when they exist. A zone opens to its number line and a gallery of its unsure cells (REVIEW-007). A selected cell shows its crop, the AI call and the zone's cells as small tiles, with the type bar on the slide (REVIEW-019). Extras such as the track record are collapsed rows, and hovering a zone or cell on the slide shows its numbers. Node staging, for sentinel nodes: per area, a header that states the area's role (the largest "sets the category", a smaller one "can't change the category"), the size scale, then three steps in order: 1 is it tumor (REVIEW-016), 2 how big is it (MEAS-006), 3 how many tumor cells, only for a cluster near 0.2 mm (REVIEW-008). Model warning bar on top when needed in both layouts.
  Refs doc 36, mock 6, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md), [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).
  Done when component tests cover what the panel shows and does in every situation of mock 6 (nothing selected, zone, cell, outline, after learning, node staging).

- [x] REVIEW-003 · Staging computation API
  Per node, the lead area (the largest not ruled out), its size (the measurement when there is one, else the AI size with its evaluated range), its category (over 2 mm macro, over 0.2 mm or more than 200 cells micro, else ITC), whether it needs a cell count (size at or under 0.2 mm), the suggested pN stage with the (sn) suffix, and the state open, so far or settled. Settled means the lead area is confirmed tumor, measured, and its count range is under 200 when a count is needed. The count range reuses doc 33's expected-mistakes method.
  Done when unit tests cover each category boundary, a lead area ruled out (the next largest takes over), the count rule and an area that could still outrank the lead.
  Refs doc 33, doc 36, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md), [ADR 0086](adr/0086-node-staging-rules.md). The validation fixture property moved to REVIEW-020.

- [ ] REVIEW-004 · Staging hero and size scale
  Plain-words heading, chip, sub-line and a log size scale from 0.05 to 20 mm with ITC, micro and macro zones, a dot per area, and the current area's range band and numbered point. For a cluster, a count bar with the 200-cell line.
  Done when component tests cover every state and a unit test checks the scale geometry at the 0.2 and 2 mm lines.
  Refs [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] REVIEW-005 · Number line
  One line with the tumor share and its likely range for the slide, the open zone or a drawn outline. Opening it shows counts per class, each bar split into cells the AI is sure about (solid) and unsure cells (hatched in the unsure token), a total row split into checked by you, sure and unsure, and the cutoff verdict chip from REVIEW-017 when the lab sets a cutoff. Every answer moves cells from unsure to checked at once.
  Done when component tests render seeded counts in each state and a unit test checks that the parts add up to the total.
  Refs mock 6, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-006 · Cells to check selection
  Per zone (REVIEW-018), contested-first order (tumor probability nearest 50%), excluding reviewed cells. Zones are ranked by unsure cells, and the scattered unsure cells come last.
  Done when unit tests confirm ordering within and across zones on a seeded result.
  Refs doc 33, mock 6, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-007 · Cells gallery in the zone view
  The open zone's unsure cells as tiles in the findings panel, each marked on the slide. Click a tile or a cell on the slide to select it, J for the next unsure cell, "Rest look right" (Shift+K) keeps every remaining call in the zone. There is no separate gallery screen, mock 9 opens a zone in findings.
  Done when E2E checks a zone by mouse and by keyboard and every decision is persisted.
  Refs mock 6, mock 9, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-008 · Settled rule
  For a small cluster, the tumor cell count settles when its range can no longer cross 200. Chip moves from open to settled with a toast "You can stop here". The same rule drives REVIEW-017 for cellularity cases.
  Done when unit tests cover the rule and E2E sees the toast after the expected number of decisions.

- [ ] REVIEW-009 · Focus mode for one cell
  Enter on a selected cell zooms in with every other cell faded and zone outlines hidden. The type bar, keys and arrow jumps are the same as in findings (REVIEW-019). Enter or Esc goes back. Minimap shrinks to the locator.
  Done when E2E reviews a zone by keyboard only in focus mode and the bar never covers the cell.
  Refs mock 10, kit W5, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-010 · Review decisions API
  Keep, retype, not a cell, skip, with reviewer, time, AI call and confidence at decision time. Reviewed shapes are never re-typed by a model afterwards.
  Done when API tests cover each decision and the "never re-typed" rule.
  Refs doc 22.
  Decisions are stored per reviewer in the reviewed layer (RSET-007).

- [ ] REVIEW-011 · AI wording modes
  Plain words (default), percent, frequency, with the validated phrases "tumor", "probably tumor", "tumor or immune".
  Done when unit tests map calibrated probabilities to phrases with the doc 28 band thresholds.

- [ ] REVIEW-012 · Outline display modes
  Fade (default, opacity from calibrated probability), mark unsure, bands, with the formulas from the mock. Unsure marks and zone outlines are neutral, white dashes with a dark casing, never a hue, because every hue sits near a class colour for some colour-vision deficiency.
  Done when golden tests cover each mode.
  Refs mock §2.4, doc 33, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

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

- [ ] REVIEW-016 · Your call on an area
  Tumor, Not tumor or Unsure per area, with Enter for Tumor. The call is the verdict on the area's ID (GUIDE-001), ticks the area in the list and moves the progress bar. Unsure keeps the area open and lists it before submit. Marking the lead area Not tumor hands the category to the next largest.
  Done when component tests cover the three calls and toggling off, and API tests persist the call with the reviewer and time and write it to the audit log.
  Refs kit W3, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] REVIEW-017 · Tumor share verdict for cellularity cases
  The doc 33 verdict (tumor share against a cutoff, range, firm, open, settled) for specimen types where the lab asks for tumor cellularity, for example a block chosen for molecular testing. Off for sentinel nodes, set per specimen type in lab settings. Shown as the verdict chip in the number line (REVIEW-005), worded "Above 20% whatever the unsure cells are" or "Could be either side of 20%, check the unsure cells".
  Done when unit tests reproduce doc 33's examples and a test confirms the verdict is hidden for a sentinel node case.
  Refs doc 33, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md), [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-018 · Zones where the AI is unsure
  From the whole-slide cells: a grid of 128 px squares at level 0 (about 31 µm), the share of unsure nuclei per square as in POC `uncertaintyField`, squares with at least 3 nuclei and at least 30% unsure joined edge to edge, zones with fewer than 4 unsure cells dropped. Each zone keeps its cells, its unsure cells and a soft outline, and is named by the most common pair of top-two types among its unsure cells, or "second typer disagrees" or "maybe not cells" when those flags dominate. No other description is generated. Recomputed after corrections and after the learner re-checks the slide. Thresholds are settings until AINUC results on whole slides confirm them.
  Done when unit tests on a seeded grid cover joining, dropping, naming and ranking, and a test on the mock's 929 nuclei gives two zones of 26 and 24 unsure cells and 31 scattered ones.
  Depends on AINUC-003. Refs POC [`src/segment/confidence.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/confidence.ts), mock 6, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-019 · Type bar next to the cell and arrow jumps
  A bar beside the selected cell with Keep, Tumor, Stroma, Immune, Other and Not a cell, each with its key in a keycap (K, 1 to 4, X), placed below or above the cell so it never covers it, and the only place the type buttons appear. Each type names what it covers on hover (immune: lymphocytes, plasma cells, histiocytes). Clicking any cell on the slide selects it. While a cell is selected the arrow keys jump to the nearest unsure cell in that direction (within a cone, undecided cells first, across zones), Shift+arrows pan, J and Shift+J step through the zone, Esc goes back to the zone and then to the list.
  Done when E2E answers cells with the mouse only and with the keyboard only, and unit tests cover the direction search and its edge cases (no cell that way, cells already decided).
  Refs mock 6, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] REVIEW-020 · Firm staging answers on a validation set
  Run the node staging of REVIEW-003 on labelled small clusters and confirm that a firm count (its range cannot cross 200) is never on the wrong side of the pathologist's count, as POC doc 33 found for the tumor share on PanNuke.
  Done when a result file records the clusters, the firm share and every wrong firm answer, and a test replays the fixture.
  Depends on REVIEW-003, AINUC-012. Split from REVIEW-003 by [ADR 0086](adr/0086-node-staging-rules.md).

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
  Keys follow the project taxonomy, 1 to 9 (PROJ-004).

- [ ] ANN-012 · Class taxonomy per tenant (moved)
  Moved to PROJ-004, because classes belong to a project ([ADR 0053](adr/0053-ai-results-review-direction.md)).

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
  Refs mock 11, doc 34 §6.
  Result sets and their styles are the top of the Layers tab (VIZ-001).

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

- [x] ANN-020 · Annotation persistence API
  CRUD with versioning, append-only history, bulk operations, tenant isolation, PostGIS geometry in level-0 coordinates.
  Done when API tests cover CRUD, history and bulk accept of 10,000 shapes under the latency budget.
  Depends on STACK-021. Tables in [ADR 0076](adr/0076-annotation-and-ai-result-storage.md).

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
  Importing a file as a result set goes through RSET. This task covers importing a file as editable annotations in Annotate.

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
  Done when the measurement categories per specimen (macro over 2 mm, micro over 0.2 mm or more than 200 cells, ITC up to 0.2 mm and up to 200 cells) and the pN wording with the (sn) suffix are confirmed from current staging guidance, checked with a pathologist, and recorded in an ADR.

- [ ] MEAS-001 · Ruler tool
  Drag to measure with the value on the line in mono digits, Shift snaps to 45°, double-click snaps to the long axis of the area under the pointer.
  Done when unit tests cover length in µm on slides with different microns per pixel and the long-axis snap.
  Refs mock 8.

- [ ] MEAS-002 · Area and perimeter for closed shapes
  Done when unit tests check areas against analytic shapes.

- [ ] MEAS-003 · Measurement list in the inspector
  Each measurement with area, value, time, category chip.
  Done when component tests cover the list.

- [ ] MEAS-004 · Idea: Report linkage
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. The clinical report is an idea.
  The largest relevant measurement fills the report's largest deposit and category with its source named.
  Done when E2E measures and the report draft shows the value and source.
  Depends on REPORT-004.

- [ ] MEAS-005 · Units setting
  µm and mm automatically or always µm.
  Done when tests cover both settings.

- [ ] MEAS-006 · Measure as a step of the area
  "Measure" in the area panel opens the ruler at a magnification where the whole area fits, already drawn along the area's long axis for the doctor to adjust. The panel compares the value with the AI size (within the evaluated range is normal, outside it asks for a check), the value replaces the AI size in the panel, the area list and the size scale, and the largest measurement feeds MEAS-004.
  Done when E2E measures the lead area, the hero settles, and a unit test computes the pre-drawn line from an area outline.
  Depends on MEAS-001, AITUM-003. Refs mock 8, kit W21, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

---

## 17 COLLAB · Comments, realtime and second opinion

- [ ] COLLAB-000 · Research check
  Done when STACK-024 is confirmed and the event model (topics per tenant, case and user) is written as an ADR.

- [ ] COLLAB-001 · Realtime infrastructure
  Authenticated connections to Durable Object rooms per slide, per task and per user, fan-out from API events, refetch on reconnect ([ADR 0003](adr/0003-pilot-platform-architecture.md)). Room tokens expire within minutes, a reconnect rechecks the grant, and removing someone from a project or workspace closes their sockets ([threat model](security/threat-model.md) R2).
  Done when tests confirm a user never receives another tenant's events and a reconnecting client refetches and converges on the current state.

- [ ] COLLAB-002 · Threads API
  Threads anchored to an object ID (OBJ-001), an ROI, a point or a shape, with title, messages, resolve and reopen, delete with confirmation when replies exist. Mention and reply notifications resolve to their thread through `GET /api/me/notifications/{id}/target` ([ADR 0091](adr/0091-notification-catalogue-and-targets.md)). `notifications.context_of` gives thread notifications their project, task and case, so a mute catches replies ([ADR 0119](adr/0119-inbox-mutes-for-projects-tasks-and-cases.md), inbox mutes).
  Done when API tests cover anchors, permissions and audit.
  During blind review a reviewer sees only their own threads and the researcher's (TASK-004), through `parfocal_api.blinding.sees_reviewer` ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md)). Depends on OBJ-001, TASK-004.

- [ ] COLLAB-003 · Comment tool and pins
  C places a pin and opens the composer, Enter posts, Shift+Enter adds a line. Pins show initials, store an offset relative to their target, follow and hide with their shape, and are draggable with undo.
  Done when interaction tests cover placing, dragging and following a moved shape.
  Refs doc 15, mock 12.

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
  Who is viewing a slide now, shown on the slide and on the project page.
  Done when E2E with two users shows presence within 2 s and it clears on leave.

- [ ] COLLAB-008 · Idea: Ask for a second opinion
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Pick a colleague (same organisation or guest from another), send the current view and its threads, create a guest link when external, move the case to waiting on others.
  Done when E2E covers internal and external requests end to end.
  Depends on IAM-010.

- [ ] COLLAB-009 · Idea: Guest view
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A guest opens the case at the exact view without installing anything, can measure and reply, sees only the shared threads. Initials mode is on while a guest is viewing.
  Done when E2E covers the guest journey and permission tests confirm the limits.

- [ ] COLLAB-010 · Follow my view
  A user can share their live camera and others can follow until they move.
  Done when E2E with two pages shows the follower's camera tracking within 300 ms.

- [ ] COLLAB-011 · Live shared cursor in compare and follow modes
  Done when tests cover cursor broadcast throttling and display.

- [ ] COLLAB-012 · Open threads at submit and sign-off
  Submitting a review and signing off a task warn on open threads but do not block.
  Done when E2E submits with an open thread and sees the warning.


- [ ] COLLAB-013 · Idea: Consult record and structured opinion
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A consult has a requester, a consultant, a question, the view it is about, a due date and a state (requested, accepted, declined, answered, closed). The opinion is agree, disagree or cannot say, with text and attached measurements or snapshots, so the requester's report can quote it. Declining names another consultant. The consultant's access ends when the consult closes or expires.
  Done when API tests cover every state, the quotable opinion, declining with a suggestion and access ending on close.
  Depends on COLLAB-008, IAM-010. Refs kit W56, kit Flow 15.

- [ ] COLLAB-014 · Idea: Secure links for signed reports
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A signed report, or a read-only view of it, is shared through a link bound to the recipient's email. Opening it needs a code sent to that address, it expires, and the sender can revoke it. Every opening is logged, and a recipient who says it was not meant for them revokes it.
  Done when API tests cover the code, expiry, revocation, the "not for me" path and the audit entries.
  Depends on IAM-019, REPORT-015. Refs kit W57.

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
  Each pane is labelled Left or Right with a chip naming its slide. The chip opens a list of the case's slides. Picking the slide shown on the other side swaps the two. The inspector repeats the two slots with Change buttons and Swap sides.
  Done when E2E puts A2 next to A1 from a pane chip and from the inspector, and a test confirms the swap rule.
  Refs kit W14, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] CMP-005 · Rotation support
  Rotate a pane for alignment, off by default for input devices.
  Done when tests cover rotation in linked mode.

- [ ] CMP-006 · Semi-automatic alignment
  Optional coarse registration from thumbnails to propose an initial offset.
  Done when a test aligns two serial-section fixtures within a tolerance, or an ADR defers it.

- [ ] CMP-007 · Compare entry points and per-side layers
  "Side by side" on any slide in the slides popover opens it next to the current one. "Compare slides" opens the screen with the right-side picker already open. Layers (tumor map outline, measurements, comments) are chosen per side.
  Done when E2E opens a pair from each entry point and a golden test shows an overlay on one side only.
  Depends on CASE-002. Refs [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

---

## 20 CASES · Cases and patients

Cases are optional groups of slides inside a project (PROJ-001). Patient fields exist only in clinical projects (PROJ-002). The built case model and case creation are reworked for projects, and accession numbers, folders, routing and the case state machine are reverted, by the ADAPT epic. LIS, FHIR and the hospital case handling are ideas ([ADR 0053](adr/0053-ai-results-review-direction.md)).

- [x] CASES-000 · Research check
  Done when STACK-040 is confirmed and the case data model is written as an ADR.
  The model is [ADR 0036](adr/0036-case-data-model.md).

- [x] CASES-001 · Patient and case model
  Patient (name, sex, birth date or age, MRN, encrypted per SEC-004), case (accession, priority, due, specimen, clinical note, clinical question, assignee, status), specimen, block, slide, as [ADR 0036](adr/0036-case-data-model.md) describes. The case's folder arrives with CASES-003. SEC-004 already created `patients` with the encrypted name, MRN and birth date and their blind indexes ([ADR 0034](adr/0034-blind-indexes-for-encrypted-patient-identifiers.md)), so this task adds the remaining columns and tables.
  Done when migrations, API tests and isolation tests pass.

- [ ] CASES-002 · Case creation UI
  Create a case inside a project with its ID and specimen. In a de-identified project a case has an ID only. In a clinical project patient fields are offered and every one is optional.
  Done when E2E creates a case in each privacy mode and uploads a slide into it.
  Depends on CASES-013, PROJ-007. Refs mock: newcase/case, mock: newcase/casec.

- [x] CASES-003 · Folders and spaces
  Folders by service with colours, membership, counts. Adds the folder to each case, which CASES-001 left out.
  Done when API tests cover folders. The folder screens and their component tests moved to CASES-025.

- [x] CASES-004 · Accession number rules
  Per-tenant format and uniqueness.
  Done when tests cover format validation and collisions.
  Built as [ADR 0037](adr/0037-accession-number-templates.md) says.

- [ ] CASES-005 · Idea: Patient history
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Earlier cases and reports for a patient across years.
  Done when E2E opens a historic report from the patient view.

- [x] CASES-006 · CSV import
  Patients, cases and slide manifests with a dry run, validation report and idempotent re-run.
  Done when tests import a 500-row file twice without duplicates.

- [ ] CASES-007 · Idea: FHIR import
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Patient, ServiceRequest and Specimen bundles mapped to our model.
  Done when contract tests import sample bundles.

- [ ] CASES-008 · Idea: LIS adapter interface
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A documented adapter interface for intake (orders) and output (reports), with a no-op adapter and a file-drop adapter for the pilot.
  Done when tests run the file-drop adapter end to end.

- [ ] CASES-009 · Search API
  Projects, cases, slides, object IDs by any part of the full path (OBJ-004) and people, with scopes, and patients only in clinical projects, tenant-scoped, PHI-safe ranking.
  Done when tests meet the STACK-034 latency on seeded data.
  The owner decided on 2026-10-31 that the 100 ms budget is measured on one fixed reference machine, not on hosted CI runners, and that small timing differences on shared machines are not failures.
  Refs [ADR 0094](adr/0094-search-on-postgres.md).

- [ ] CASES-010 · Idea: Report output through the adapter
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Done when a signed report reaches the file-drop adapter as FHIR and PDF.
  Depends on REPORT-013.

- [x] CASES-011 · Case assignment and routing rules
  Assign by folder, specimen and load, STAT first.
  Done when unit tests cover routing rules.


- [x] CASES-012 · Case state machine
  One state model behind the worklist, the board, the report and outgoing messages: waiting for slides, waiting for AI, ready to review, in review, waiting on others (with the reason: lab work, second opinion, clinical question, supervision), report drafted, with the supervisor, signed, amending and cancelled. Each transition has the actors who may make it. States that follow from data (slides arrived, AI done, sub-tasks open) are derived, the rest are moved by people. Priority and due time are attributes, not states.
  Done when a table-driven test covers every allowed and refused transition with its actor, and a property test proves every state is reachable and signed is reachable only through sign-out.
  Depends on CASES-001. Refs kit Case lifecycle and data page, [ADR 0023](adr/0023-gap-review-backend-first.md). Built as [ADR 0038](adr/0038-case-state-machine.md) says.

- [x] CASES-013 · Case creation API
  Create a case with an existing or new patient, specimens with blocks and their expected levels and stains, clinical information, requesting clinician and priority. Service, due time, assignee and AI plan are filled from the lab rules (CASES-022, CASES-023, AIP-016) and can be overridden. A case may be saved as a draft, which only its author and the lab see. The accession number is assigned on creation (CASES-004) and creation is idempotent per request key.
  Done when API tests cover creation with each default and override, drafts and their visibility, idempotency and the audit entry.
  Depends on CASES-001, CASES-004. Refs kit Flow 10. The defaults come from `case_creation.RULES`, which returns nothing until CASES-022, CASES-023 and AIP-016 plug in their rules.

- [ ] CASES-014 · Idea: Field ownership between the LIS and the app
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A case from the LIS marks the fields the LIS owns (patient, specimen, requester) as read-only in the app, and an edit is refused with a pointer to the LIS. Fields the app owns stay editable and are audited. After sign-out a change to anything on the report needs an amendment.
  Done when API tests cover a refused LIS-owned edit, an allowed app-owned edit and a post-sign-out edit that is refused without an amendment.
  Depends on CASES-008, CASES-013. Refs kit W43, kit Flow 9.

- [ ] CASES-015 · Idea: Patient matching and duplicates
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  The same birth number means the same patient. The same name and birth date without a birth number is a possible duplicate, returned as candidates. Creating a new patient against a candidate needs a reason. Merging two patients is a lead's or administrator's action, keeps a record that can be reversed and is never automatic.
  Done when unit tests cover each matching rule, and API tests cover the reason, a merge and its reversal with audit entries.
  Depends on CASES-001. Refs kit W42.

- [ ] CASES-016 · Slides that match no case
  A slide whose file name names no case stays loose in the project, and a result file that matches no slide waits in the upload's Not matched yet list until the user picks one. A loose slide can be filed into a case later.
  Done when API tests cover loose slides, filing one later and an upload whose other files are unaffected.
  Depends on CASES-013, INGEST-021, RSET-004. Refs mock: upload/files.

- [ ] CASES-017 · Moving a slide between cases
  A slide moves with its history to another case in the same project. Its result sets, IDs, verdicts and threads move with it, and the researchers of tasks that hold it are notified. A move is refused while a task that holds the slide is signed off, until it is reopened (ADJ-004). A reason is required and both cases log the move.
  Done when API tests cover a move, a refused move on a signed-off task and the moved result sets, with audit entries on both cases.
  Depends on CASES-012, ADJ-004. Refs kit W44, kit Flow 12.

- [ ] CASES-018 · Idea: Expected slides
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Blocks with their levels and stains create expected slides. Arriving slides fulfil them. A case waits for slides until the first one arrives, and expected slides still missing are reported to the sign-out checks.
  Done when API tests cover fulfilment by barcode, a missing level reported at sign-out, and a case leaving waiting for slides.
  Depends on CASES-013, REPORT-006. Refs kit W43.

- [ ] CASES-019 · Idea: Cancel, restore and merge cases
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A lead cancels a case with a reason. A cancelled case leaves every list, stays findable by search and can be restored for 30 days. A signed case cannot be cancelled. Two cases created for the same specimen can be merged into one, and the old accession keeps resolving to the merged case for links and notifications.
  Done when API tests cover cancel, restore, the refusal on a signed case, a merge and an old link that resolves after it.
  Depends on CASES-012. Refs kit W43, kit W65.

- [x] CASES-020 · Next slide in a task
  Given a slide and the task or list it was opened from (a task, the All slides tab or search results), return the next and previous slide, skipping slides already submitted where the task says so. The end of the task is reported as the end.
  Done when API tests cover each list kind, skipping and the end of the list.
  Depends on WL-001, TASK-001. Refs kit Navigation map, kit W61, kit Flow 16.

- [ ] CASES-021 · Back targets in deep links
  Every link the app produces (notifications, shared links, emails, search results) carries where it came from, so the client can return there. Links to moved slides and to merged objects resolve to their new place.
  Done when API tests resolve links after a slide move and an object merge (OBJ-003), and every link kind in the notification catalogue (NOTIF-006) carries its origin.
  Depends on CASES-017, OBJ-003, NOTIF-006. Refs kit Navigation map.

- [ ] CASES-022 · Idea: Assignment rules with a test run
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Rules are ordered and the first match assigns the case. A rule matches on service, specimen, priority, folder or source and assigns to a person, a team by load, a resident together with their supervisor, the consultant named in a consult, or the pool. Nobody away is ever chosen (IAM-015, TEAM-001). Rules are versioned with their author. A test run applies a rule set to past cases and returns each person's count, the pool count and anyone over capacity, without changing anything.
  Done when unit tests cover ordering, each target, absences and the pool fallback, and an API test runs a rule set over a seeded week.
  Depends on CASES-011, TEAM-003. Refs kit W50, kit Flow 24, [ADR 0023](adr/0023-gap-review-backend-first.md).

- [ ] CASES-024 · Sorting dropped files into cases
  Given a set of dropped files (slides and AI result files), decide for each slide its case from the file name or keep it loose, leave out slides the project already has, and hand result files to pairing (RSET-004). Every decision can be changed before anything is applied. Applying is one transaction: cases are created, slides go to their cases, and result sets are created for the paired files.
  Done when API tests cover each decision, an override, a duplicate, a file with no case and a failure that leaves nothing half applied.
  Depends on CASES-013, INGEST-011, PROJ-001. Refs mock: upload/files, doc 37 "AI results and import".

- [ ] CASES-025 · Idea: Folder screens
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Folders by service are an idea. Projects group the work.
  Split from CASES-003. The folder list with colours and open case counts, editing a folder, choosing its people and filing a case into a folder, in the kit's style.
  Done when component tests cover each screen and an E2E test files a case into a folder.
  Depends on CASES-003 and the final UI shell.

- [ ] CASES-023 · Idea: Due time rules
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  Due time comes from the priority and specimen type, counted in the lab's working calendar with its holidays and working hours. Changing the rules affects only new cases.
  Done when unit tests cover each priority, a holiday, a weekend, a daylight saving change and a rule change that leaves existing cases alone.
  Depends on CASES-013. Refs kit W68. Fills `due_at` through `case_creation.RULES`.

---

## 21 AIP · AI platform: registry, tiers, jobs, GPU pool

Models run on demand as model runs that create result sets (JOBS) and nothing runs on arrival ([ADR 0053](adr/0053-ai-results-review-direction.md)). Tiers stay for the interactive tools in Annotate.

- [ ] AIP-000 · Research check
  Re-check doc 20's ranked list against the current literature (nucleus segmentation and typing models, pathology foundation models, promptable segmentation) and confirm STACK-022, STACK-027 and STACK-031.
  Done when an ADR lists the v1 model line-up per tier and its licence status.

- [ ] AIP-001 · Model artifact storage
  Versioned, immutable model artifacts (PyTorch, ONNX, quantised variants, calibration files) with checksums.
  Done when tests reject an artifact whose checksum does not match.

- [ ] AIP-002 · Model registry
  Model family, task (tumor map, detector, typer, interactive encoder, decoder), version, licence of weights and data, allowed tenant types, input microns per pixel, calibration temperature, evaluation report link, status (candidate, validated, retired).
  Done when API tests cover registration and the licence rule from STACK-031 blocks a non-commercial model in a commercial tenant.
  Each model is either a Parfocal model, always listed unless a researcher with admin rights hides it (JOBS-006), or a lab model behind the lab's own endpoint (JOBS-005), and records what it makes (regions, cells, heatmap).

- [ ] AIP-003 · Tiers Best, Good, Fast
  Tier mapping per task and per site, set by the lab, with the exact model visible on hover.
  Done when API and component tests cover mapping and hover details.
  Refs mock §2.14, kit decision D5.

- [ ] AIP-004 · Model tier picker
  The picker dialog in Annotate and the tier chip in Review.
  Done when component tests cover the choices and behaviour of mock 11 "choosing a model".

- [ ] AIP-005 · Idea: Validation mapping per site and specimen
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Validation per specimen belongs to the clinical direction.
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

- [ ] AIP-010 · Idea: Pre-read on arrival
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Models run when a person starts them (JOBS-001).
  When a slide is published, the pipeline runs tissue, tumor map, then cells, in priority order with STAT first. Pause queue and run STAT first controls. Held jobs await a decision when no validated model applies.
  Done when E2E uploads a slide and the worklist AI cell goes from queued to ready.

- [ ] AIP-011 · Job progress streaming
  Per-stage progress and partial results stream to the slide view, the jobs tray and job window (JOBS-003, JOBS-004) and the upload window (queued, tiles read, tissue found, model running, objects placed, IDs given, result set added), with a pause reason when a stage waits. Each finished stage records its throughput per model, tier and machine, so time estimates (JOBS-002) use measured values.
  Done when tests confirm partial areas arrive before job completion and throughput is recorded per stage.
  Refs [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

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


- [ ] AIP-016 · Idea: AI plan per specimen type
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  The lab sets which AI steps (tumor map, tumor areas, cell detection, cell typing) run for each specimen type and at which tier. A step whose model is not validated for that specimen (AIP-005) is off by default, and turning it on marks its cases "not validated". The plan is versioned and is what new cases and uploads start from.
  Done when API tests cover the plan, the validation rule and the plan a new case receives.
  Depends on AIP-003, AIP-005. Refs kit W68.

- [ ] AIP-017 · Idea: Model approval and monitoring
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned.
  A model version becomes available for a specimen type only when a lead approves it with an electronic signature, after a site validation report (MLEVAL-008) meets the lab's thresholds. In use, the share of its calls that doctors change is tracked per specimen type, and passing the lab's threshold reopens validation and tells the lead.
  Done when API tests cover approval, refusal below a threshold and the signature record, and a test with seeded review decisions raises the alert.
  Depends on AIP-005, MLEVAL-008, SEC-023. Refs kit W69, kit Flow 28.

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

- [x] AINUC-003 · Chunk schema with probabilities
  Every chunk carries type probabilities and flags so confidence features work on paged results.
  Done when a schema test fails if probabilities are missing.
  Refs docs 31, 33, [ADR 0076](adr/0076-annotation-and-ai-result-storage.md).

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
  The least sure first order applies the temperature before it rates objects, when a task is made ([ADR 0117](adr/0117-review-order-is-stored-per-task-slide.md), review order stored per task slide).

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

- [ ] AINUC-012 · Tumor cell count per area
  Count tumor-typed nuclei inside an area outline, with the expected-mistakes range from calibrated probabilities, for clusters at or under 0.2 mm where 200 cells decide between isolated tumor cells and a micrometastasis. Uses the 64 px tumor map cells or nuclei, never the coarse 256 px map, for clusters this small.
  Done when unit tests count seeded nuclei inside outlines with the range, and an evaluation against a pathologist's counts on small clusters is recorded as a result file or the gap is filed as a TODO.
  Depends on AINUC-006, AITUM-003. Refs doc 36, [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

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
  Cells at or above 0.5 form areas by 8-connectivity, an area is listed only if its peak reaches 0.97, its size is the widest distance across the convex hull of its cells in mm, and it carries a category, a likely size range and flags for "near a line" and "too small for the map". Areas are ordered largest first. The range comes from the MLEVAL evaluation, not a constant.
  Done when unit tests cover connectivity, the peak filter, the hull diameter and the category lines, and an evaluation on CAMELYON16 test slides records per-deposit size error and stray areas as a result file. The POC reached 7 areas for 6 deposits and 8.1 mm against 8.1 mm on tumor_009, a training slide.
  Refs doc 36, [`poc/src/segment/tumor-areas.ts`](https://github.com/fedasevich/pathlogy-poc/blob/master/src/segment/tumor-areas.ts), [`poc/scripts/tumor-areas.mjs`](https://github.com/fedasevich/pathlogy-poc/blob/master/scripts/tumor-areas.mjs), [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

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
  After a few corrections on a slide (10 by default) the learner re-checks the slide. The cells it changed form a zone in findings, "Changed after your corrections", reviewed with the same type bar and keys, with Undo all that restores the typer's first calls and keeps the doctor's own corrections. Learning applies to that slide only. A collapsed row shows how many examples the learner has, with forget.
  Done when component tests cover the zone, undo and forget, and an E2E sees the zone appear after the set number of corrections.
  Refs mock 6 "After learning", [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

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

- [x] MLEVAL-000 · Research check
  Confirm metrics and datasets (PQ, AJI, mIoU, NoC@85 and @90, ECE, FROC) and dataset licences.
  Done when an ADR lists the datasets and their allowed use.
  Refs [ADR 0093](adr/0093-evaluation-metrics-and-datasets.md).

- [x] MLEVAL-001 · Dataset registry and loaders
  MoNuSeg and PanNuke as reference only (in PathoSAM's training set), TNBC, CryoNuSeg, NuInsSeg as held-out, Lizard as native 20×, CAMELYON16 test slides for tumor maps.
  Done when loaders pass checksum and sample tests.
  Refs docs 20, 26, [ADR 0093](adr/0093-evaluation-metrics-and-datasets.md), [result](results/2026-10-18-dataset-loaders.md). Loaders exist for TNBC and NuInsSeg, and CAMELYON16 comes through `packages/test-fixtures`. The datasets behind a sign-in or without a published checksum moved to MLEVAL-010.

- [x] MLEVAL-002 · Geometric scorer
  4× supersampled centre sampling, PQ, AJI, F1, per-organ and per-tissue breakdowns.
  Done when the scorer reproduces POC numbers on the same inputs.
  Refs [`poc/server/tools/score_*`](https://github.com/fedasevich/pathlogy-poc/tree/master/server/tools), doc 26. Result: [geometric scorer reproduction](results/2026-10-18-geometric-scorer-reproduction.md).

- [ ] MLEVAL-003 · Interactive protocol
  Realistic clicks (centroid with jitter), loose boxes, refinement clicks, NoC@85 and NoC@90.
  Done when the harness reproduces doc 26's held-out click and box numbers within tolerance.

- [x] MLEVAL-004 · Typing and calibration evaluation
  Accuracy, balanced accuracy, confusion matrix with viewer-class mapping, ECE and band accuracy.
  Done when the harness reproduces doc 29's HoVer-NeXt numbers on the same fold.
  Result: [typing and calibration reproduction](results/2026-10-18-typing-calibration-reproduction.md).

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

- [ ] MLEVAL-010 · Loaders for datasets behind a sign-in
  Loaders for PanNuke (Warwick publishes no checksum, so the first verified download becomes the reference), MoNuSeg (Google Drive), CryoNuSeg (Kaggle sign-in, licence still unknown) and Lizard (CoNIC registration), registered as in MLEVAL-001.
  Done when each loader passes checksum and sample tests against an archive in the dataset cache.
  Depends on MLEVAL-001. Split from MLEVAL-001, see [ADR 0093](adr/0093-evaluation-metrics-and-datasets.md).

---

## 27 SET · Settings

Scopes: personal (follows the user), this device (stays with the computer), set by the lab (shown, locked). The full list is in mock §2.15 and the kit settings table.

- [ ] SET-000 · Research check
  Done when the settings schema with scopes and defaults is written as an ADR from mock §2.15.

- [ ] SET-001 · Settings storage and resolution
  Server storage for personal and lab settings, device storage for device settings, resolution order lab locked, then personal, then device, then default. Typed schema shared by client and server.
  Done when unit tests cover resolution for every scope combination.

- [ ] SET-002 · Settings modal shell
  Left navigation, scope badges legend, live application behind the dimmed backdrop, closes with Esc, the close button or a backdrop click. Opens with Cmd+comma and from the account menu (SHELL-012). The window keeps one stable size across sections and long sections scroll inside it, so moving between sections never resizes or moves it.
  Done when component tests cover navigation and closing, and a test confirms the window's size is the same on every section.
  Refs [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

- [ ] SET-003 · Display section
  Theme, slide brightness, density, patient names, lengths, magnification label, language (English only, shown disabled). Theme and initials only can also be changed from the account menu (SHELL-012).
  Done when tests confirm each setting changes the UI live.

- [ ] SET-004 · Layout section
  Tools rail or dock with previews, side panel width and hide, panel while moving, minimap mode, pinned slide strip (off by default, CASE-002).
  Done when tests cover each setting.

- [ ] SET-005 · AI and confidence section
  Wording with a live example, outline mode, model tiers per task, cutoff (lab, locked), inspector blocks (warnings, track record, calibration details).
  Done when tests cover each setting and the locked cutoff cannot be edited by a pathologist.

- [ ] SET-006 · Navigation and devices section
  Main device, wheel mode, double-click behaviour, speed per device, invert zoom, calibrate device. Camera feel picks a VIEW-045 (camera feel profiles) preset, Smooth, Precise or Instant, with overrides for coasting, animated jumps, zoom anchor at the cursor or the view centre, and objective detents (VIEW-046). A small live preview shows the chosen feel.
  Done when tests cover each setting and per-device speed persistence.

- [ ] SET-007 · Shortcuts section
  The rebinding editor from CMD-006, with the preset (viewer default, QuPath-like, Figma-like), filters for all, your changes and conflicts, and reset all. `?` opens Settings at this section.
  Done when tests rebind a key and the keycaps update everywhere.
  Depends on CMD-001, CMD-006. Refs mock 19, mock 21, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] SET-008 · Notifications section
  AI finished, replies, STAT assigned, STAT sound.
  Done when tests confirm the preferences gate notifications.

- [ ] SET-009 · Privacy and session section
  Initials while sharing, lock after (lab), patient banner (lab), sign out other devices.
  Done when tests cover each setting.

- [ ] SET-010 · Account section
  Name, role (lab), workspace (lab), signature block for reports.
  Done when tests cover editing and locked fields.

- [ ] SET-011 · Workspace settings console
  Workspace values for lock times, tiers, the default privacy mode, default classes, the default study template, and announcements, in the admin page (ADMIN-001).
  Done when permission tests restrict it to researchers with admin rights and changes are audited.

- [ ] SET-012 · Idea: Home and worklist choice
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. There is one home and no worklist views.
  Users pick their home (launchpad or department dashboard, the dashboard is the default for lab leads), their worklist view (list, day or grid) and whether the case preview opens on select, unless an experiment pins them.
  Done when tests cover each choice and the experiment pin.
  Refs [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

---

## 28 CMD · Command palette and shortcuts

- [ ] CMD-000 · Research check
  Done when STACK-014 is confirmed.

- [ ] CMD-001 · Key registry
  Every action registered once with id, default keys per preset, scope (global, viewer, review, annotate, worklist), chords (G then n), hold versus tap (Z, 180 ms), and input-focus awareness.
  Done when unit tests cover chords, hold and tap, scope precedence and typing in inputs.

- [ ] CMD-002 · Command palette
  Cmd+K from everywhere, fuzzy search over actions, places (projects, slides, areas, object IDs by any part of the full path) and settings, grouped results with keys shown, Enter runs the first, lab actions only in developer mode.
  Done when E2E finds and runs an action, a place and a setting.
  Refs mock 18.

- [ ] CMD-003 · `?` opens Shortcuts in Settings
  `?` and "Keyboard shortcuts" in the more menu open Settings at the Shortcuts section (SET-007). There is no separate read-only sheet, so reference and editing never disagree. The source badge per key (clinical, Figma, QuPath, ours) and every registered action appear there.
  Done when a test confirms `?` opens the section and every registered action appears in it.
  Refs mock 21, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] CMD-004 · Key conflict check
  CI fails when two actions in overlapping scopes share a key. Resolves the Shift+L conflict between arrow and compare unlink, and P between polygon and worklist preview by scope.
  Done when the check runs in CI and the known conflicts are resolved.

- [ ] CMD-005 · Presets
  Viewer default, QuPath-like, Figma-like. Presets change tool keys only, and review keys stay.
  Done when tests switch presets and assert bindings.

- [ ] CMD-006 · Rebinding UI
  Click a key next to an action and press the new one. Defaults are marked, changed keys show the default and a reset. A key already used in the same scope offers to swap the two or to leave the other action without a key. Keys the browser keeps (⌘W, ⌘T, ⌘R, ⌘L and others) are refused with the reason. Actions that change the report (sign out) need ⌘ or Ctrl. Undo and Esc stay fixed. Sets are edited as sets: the modifier for the magnification keys, the first key of a chord such as G then a number, and arrows, WASD or IJKL for directions with a clash check. Any action can have a second key. Search by name, or press a key to find what it does. Single-letter shortcuts can be switched off (WCAG 2.1.4), keys match by physical position so non-US layouts keep the map, Z can be tap, hold or both, and the map exports and imports as a file.
  Done when E2E rebinds J and the review HUD shows the new key, and tests cover a conflict swap, a reserved key, the modifier rule, a set, the single-letter switch and position matching on a Czech layout.
  Depends on CMD-001. Refs mock 19 and 21, [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

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

- [x] NOTIF-000 · Research check
  Done when STACK-036 is confirmed.
  Confirmed in [ADR 0074](adr/0074-notifications-as-rows-with-an-email-outbox.md) on 2026-10-18.

- [x] NOTIF-001 · Notification service
  Events (mention, reply, review task assigned, model run finished or paused, upload done, disagreements ready, task signed off, emergency access to a clinical project for its owners) to in-app, email and realtime channels by preference.
  Done when tests cover routing by preference and tenant isolation.
  Built as [ADR 0074](adr/0074-notifications-as-rows-with-an-email-outbox.md) says. Realtime delivery waits for STACK-024.

- [ ] NOTIF-002 · The bell
  The bell in the top bar opens a panel over the current page with For me, Mentions and Jobs, each with its unread count, Unread only, Mark all read and See all. Opening an item marks it read and goes to the exact place. The bell is the only place for mentions, and the sidebar has no Mentions entry.
  Done when component tests cover the filters, the counts, marking one read and marking all read, and E2E opens a mention from the bell on Home and lands on the thread.
  Depends on NOTIF-006. Refs mock: notifs/panel, doc 41, [ADR 0053](adr/0053-ai-results-review-direction.md).

- [ ] NOTIF-003 · Idea: STAT banner
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. There are no STAT cases in review tasks.
  A banner on any screen outside an open case when a STAT case is assigned, with an optional sound. While a slide is open nothing is shown (NOTIF-008).
  Done when E2E assigns a STAT case and the banner appears in another session, and does not appear in a session that has a case open until it leaves the case.

- [x] NOTIF-004 · Email templates without PHI
  Done when tests confirm subjects and bodies contain no patient identifiers and link to the app.
  Refs [ADR 0039](adr/0039-email-through-resend-with-phi-rules.md), [ADR 0091](adr/0091-notification-catalogue-and-targets.md).

- [x] NOTIF-005 · Digest and quiet hours
  Done when tests cover batching and quiet hours.
  Refs [ADR 0092](adr/0092-email-digest-and-quiet-hours.md).


- [x] NOTIF-006 · Event catalogue with deep links
  Every notification has a kind from a documented catalogue and a target link to the exact place: a slide at an object, a thread, a task, a job, an evaluation or a failed delivery. Kinds include mention, reply, task assigned, task due soon, model run finished, run paused, upload done, disagreements ready, task signed off, result set added by a webhook and integration down.
  Done when a test checks every catalogue kind has a target and a template, and API tests resolve each target for its recipient.
  Depends on NOTIF-001. Refs kit W52, kit Flow 18, [ADR 0091](adr/0091-notification-catalogue-and-targets.md). Thread and delivery targets resolve in COLLAB-002 and REMOTE-003, which do not exist yet.

- [ ] NOTIF-007 · Inbox API
  List notifications by kind and read state, mark one or many as read, and mute a project, a review task or a case so its events stop pushing and emailing that person. Muted events stay in the inbox under a filter and out of the bell's count. Mentions, emergency access and kinds that hand the person work (task assigned, task due soon) still get through as normal notifications.
  Done when API tests cover filters, bulk read, muting and tenant isolation.
  Depends on NOTIF-006. Refs kit W53, [ADR 0119](adr/0119-inbox-mutes-for-projects-tasks-and-cases.md) (inbox mutes), which widened the case mute to projects and tasks since [ADR 0053](adr/0053-ai-results-review-direction.md) made cases optional.

- [ ] NOTIF-008 · Hold notifications while reading
  While a person has a slide open, notifications are stored but nothing interrupts them: no toast, banner or sound, mentions included. When they leave the slide, what arrived is released in order. The client reports when a slide is opened and closed, and a stale report expires after the lab idle time.
  Done when tests deliver events while a slide is open and prove nothing is pushed until the slide closes, then everything arrives in order, and an expired open state releases them.
  Depends on NOTIF-001, COLLAB-007. Refs ADR 0023.

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

- [ ] EXP-003 · Idea: Home and worklist experiments
  Idea since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. The home and worklist variants it tested are ideas.
  Assignment, exposure events and metrics (time to open the first case, cases per hour, preference) for the lab leads' default home and for whether the case preview opens on select.
  Done when tests confirm stable assignment and correct exposure logging.
  Refs [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

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
  A study mode that loads public slides (CAMELYON16) with scripted tasks and records timing, for the usability plan in the kit. Round 4 tests the cell findings: open the zone where the AI is least sure, answer 4 unsure cells (round 1 wording, so the rounds compare) and change a cell you can see is a lymphocyte.
  A running round keeps its screens and tasks frozen so its sessions compare, and prototype changes start the next round.
  Done when the ten pilot tasks in the kit test plan can run end to end in study mode, with the task set editable without a deploy.
  Refs kit Usability test plan, [`poc/study/`](https://github.com/fedasevich/pathlogy-poc/tree/master/study), [ADR 0013](adr/0013-cell-findings-shortcuts-and-ai-on-upload.md).

- [ ] EXP-009 · Study session replay
  In study mode only, record the screen as a DOM recording plus a pointer and key log, with every text field masked. Serve the recorder from our own origin under a neutral name and warn on the start screen when it did not load, because ad blockers block session-recording scripts by URL. Upload in batches at task boundaries and every minute, not every few seconds, because each upload is a storage write. Results show a replay with task chips, a strip of task spans, dead clicks and reloads, and a pointer-only fallback that rebuilds screens from the logged state when the DOM recording is missing.
  Done when E2E records a scripted session and replays it with task jumps, a blocked recorder produces the start-screen warning and a working pointer-only replay, and a test confirms no unmasked text reaches the recording.
  Depends on EXP-008. Refs [`poc/study/`](https://github.com/fedasevich/pathlogy-poc/tree/master/study), [ADR 0012](adr/0012-ux-round-2-prototype-revisions.md).

- [ ] EXP-010 · Study task guard
  A study task can name destinations that are clearly wrong for it, for example leaving the case once a task has started there, or leaving the upload window in an upload task. Going there is blocked with a visible message that says where the task happens. A navigation that completes the task is never blocked, and every blocked attempt is logged and counted per task.
  Done when E2E covers a blocked attempt with its message and log entry, a completing navigation that passes, and a task with no guard.
  Depends on EXP-008. Refs [`poc/study/public/study.js`](https://github.com/fedasevich/pathlogy-poc/blob/master/study/public/study.js), [ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md).

---

## 34 OPS · Infrastructure and operations

- [ ] OPS-000 · Research check
  Done when STACK-029, STACK-030 and STACK-032 are confirmed.

- [ ] OPS-001 · Base infrastructure as code
  OpenTofu for DNS, certificates, R2 buckets, the Neon project and the Zitadel project per environment. Workers, Durable Objects and Modal resources are defined in their own config ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when `tofu plan` is clean for staging and production and a policy check passes.
  Refs [ADR 0050](adr/0050-deploy-pipeline-and-previews.md) for how this task is shaped.

- [ ] OPS-002 · Deploy definitions
  Wrangler config for the edge Worker and Pages, Modal app definitions for the API, ingest and ML functions, and the deploy scripts CI runs ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when CI recreates staging from git alone.
  Refs [ADR 0050](adr/0050-deploy-pipeline-and-previews.md) for how this task is shaped.

- [ ] OPS-003 · Environments
  Local, a preview per pull request (Workers preview version, Modal environment, Neon branch, bucket prefix) with seeded data, staging from `main` and production from tags, scaling to zero wherever the platform allows ([ADR 0003](adr/0003-pilot-platform-architecture.md)).
  Done when a pull request gets a working preview URL and closing it deletes its branch, environment and prefix.
  Refs [ADR 0050](adr/0050-deploy-pipeline-and-previews.md) for how this task is shaped.

- [ ] OPS-004 · Database operations
  Migrations in deploy, Neon's pooler, autovacuum tuning for annotation tables, a Neon read replica for reporting.
  Done when a load test with bulk annotation inserts keeps p95 API latency under budget.

- [ ] OPS-005 · Continuous deployment
  Main to staging automatically, tagged releases to production with approval, database migration safety checks, rollback.
  Done when a rollback drill on staging succeeds.
  Refs [ADR 0050](adr/0050-deploy-pipeline-and-previews.md) for how this task is shaped.

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
  Account-level caps and alerts were set on 2026-10-31 under [ADR 0115](adr/0115-production-access-and-spend-caps.md), with the table in [knowledge/platform.md](knowledge/platform.md). Budgets per environment, cost dashboards and lifecycle rules are still open.

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

- [x] TEST-002 · API test harness
  Ephemeral database per test run, factories for tenants, users, cases and slides, authenticated clients per role.
  Done when a sample test uses every factory.

- [x] TEST-003 · Tenant isolation test generator
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

- [x] TEST-016 · Test data hygiene
  No real PHI in any fixture, generated patient names marked as synthetic.
  Done when a scanner flags non-synthetic names in fixtures.

- [ ] TEST-017 · Flaky test management
  Quarantine with an issue link and an expiry date.
  Done when quarantined tests are reported weekly.

- [ ] TEST-018 · Self-hosted Mac GPU runner (dropped)
  Dropped by [ADR 0011](adr/0011-hosted-ci-only.md). No self-hosted runners are used.

- [ ] TEST-019 · Application performance on main paths
  The thesis assignment asks for the performance of the application as a whole, not only the renderer ([ADR 0114](adr/0114-thesis-assignment-tasks.md)). Scripts measure opening a slide to the first fitted image, a jump to a sharp viewport, importing result sets of 10,000 and 1,000,000 cells, a model run on a whole slide with its throughput, and the time from a verdict to the next object on screen. Each path has a budget fixed before measuring, and runs repeat after a warm-up with the median and p95 reported.
  Done when the scripts run locally against the full stack, a result file records the numbers with the machine, browser, data and method, and CI runs the CPU-side paths against their budgets.
  Depends on TEST-006, RSET-005, JOBS-001, GUIDE-002.

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
  Import the pilot's slides and their AI results into projects with the bulk import tool, with cases from file names.
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

## 40 PROJ · Projects, privacy modes, class taxonomy and templates

A project holds slides, AI results and review tasks. Cases inside it are optional ([ADR 0053](adr/0053-ai-results-review-direction.md), doc 37 "Data model").

- [x] PROJ-000 · Research check
  Done when an ADR records the project model (project, optional case, slide, result sets), the privacy modes and the project roles, and what each existing table (cases, patients, slides) becomes.
  Depends on ADAPT-000. Decided in [ADR 0062](adr/0062-project-model.md).

- [x] PROJ-001 · Project model and API
  A project has a short ID (P07), a name, a colour, a privacy mode, an analysis template, a class taxonomy, members with project roles and a status. Cases are optional, and loose slides belong to the project directly.
  Done when migrations, API tests for create, list, update and archive, and isolation tests pass, and every change is audited.
  Builds on the minimal `projects` table from ADAPT-004 and adds the API and the remaining fields ([ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md)). The contract is in [ADR 0064](adr/0064-project-api.md), and the taxonomy table comes with PROJ-004.
  Depends on IAM-004, ADAPT-004. Refs mock: project, kit: Information architecture.

- [ ] PROJ-002 · Privacy modes
  De-identified, the default, has no patient fields in any response or screen, strips names from file metadata on upload and hides label and macro images. Clinical allows patient fields, every one optional, with hidden names and logged access. Changing a project from de-identified to clinical needs a researcher with admin rights and a reason.
  Done when API tests prove no patient field leaves a de-identified project, an upload fixture with a name in its SVS metadata arrives without it, clinical reads are audited, and the mode change needs a researcher with admin rights and a reason.
  Depends on PROJ-001, SEC-004, SEC-009. Refs doc 37 "Data model", mock: newcase.

- [x] PROJ-003 · Project roles
  Owner, reviewer and viewer per project, on top of the workspace roles (IAM-022). Opening a project needs a project role, researchers included, and the creator becomes owner. A reviewer sees only the slides of their tasks, a viewer reads, and an owner manages the project. One API helper turns the workspace grant and the project role into the effective grant, and row-level security stays per workspace ([ADR 0062](adr/0062-project-model.md)). The project routes of PROJ-001 already need a role to read and the owner role to change ([ADR 0064](adr/0064-project-api.md)). This task applies the role to the case and slide routes and decides what happens to a project owner whose workspace role becomes reviewer.
  Done when the permission test runs every project endpoint for every project role, and an isolation test hides another project's slides from a reviewer.
  Depends on IAM-022, PROJ-001.

- [x] PROJ-004 · Class taxonomy per project
  Class names, colours and keys 1 to 9, started from a template (PanNuke, sentinel node) and checked for colour distance (DS-002). Mappings from imported class names (Neoplastic, tumour_cell) are stored per project and reused (RSET-005).
  Done when API tests cover templates, custom classes, the colour check rejecting a colour too close to another, and a stored mapping applied to a second import.
  Depends on PROJ-001. Refs doc 37, mock: upload/check. The API carries its own port of the colour check, so this no longer waits for DS-002 ([ADR 0067](adr/0067-class-taxonomy-and-colour-check.md)).

- [ ] PROJ-005 · Analysis templates
  A project turns on an analysis template. Sentinel node staging adds the staging hero, the area list and the measure step (REVIEW-003, REVIEW-004, CASE-004, MEAS-006). Cell review adds unsure zones and cell typing. None shows objects, layers, verdicts and the opinion form only.
  Done when API tests cover each template and component tests show the staging cards only with the staging template.
  Depends on PROJ-001. Refs doc 37 "Viewer", mock: case.

- [ ] PROJ-006 · Project page
  A header with the name, privacy tag, members and Upload and New review task, then tabs. Slides lists the slides grouped by case with result sets and reviewers, filters (result set, needs review, no results) and a search, and a row opens the slide with Open shown on hover. Review tasks lists the project's tasks. Settings is PROJ-008. Files dropped anywhere on the page open the upload (INGEST-021).
  Done when component tests cover each tab and filter, and E2E opens a slide from a row and starts an upload by dropping files.
  Depends on PROJ-001, WL-001. Refs mock: project, doc 38 "Project", doc 40 R5.

- [ ] PROJ-007 · New project and new case
  New project asks for a name, the privacy mode as plain radio rows with a sentence each, a template and a class list. New case inside a project asks for its ID and specimen, and patient fields only in a clinical project.
  Done when component tests cover both forms in each privacy mode and E2E creates a project and a case.
  Depends on PROJ-002, PROJ-004, ADAPT-005. Refs mock: newcase.

- [ ] PROJ-008 · Project settings
  Privacy mode, review defaults (blind review, hide the AI for a first read), the default study template (EVAL-007), the analysis template, the taxonomy, the opinion form (GUIDE-006), automatic imports (REMOTE-002), the ID matching thresholds (IoU for regions, distance for cells, [ADR 0071](adr/0071-object-id-grammar.md)) and members with project roles.
  Done when component and API tests cover each setting and its audit entry.
  Depends on PROJ-003, PROJ-004, PROJ-005, GUIDE-006. Refs mock: project/settings.

---

## 41 RSET · Result sets and AI result import

Importing AI results made elsewhere is first class. A result set is one import or one model run on one slide ([ADR 0053](adr/0053-ai-results-review-direction.md), doc 37 "AI results and import").

- [x] RSET-000 · Research check
  Done when an ADR names the parsers for GeoJSON, QuPath exports, CSV and TSV, and masks and heatmaps, and the Parfocal JSON schema is drafted.
  Decided in [ADR 0070](adr/0070-result-file-parsers.md), with the [draft schema](reference/parfocal-results-v1.schema.json) and a [spike](results/2026-10-18-result-parsers-spike.md).

- [x] RSET-001 · Result set model and API
  Per slide: model name and version, date, source file or run, imported or run here, class mapping, object count and stats. The AI output is immutable. Result sets list in the project and the slide view.
  Done when API tests cover create, list and delete, isolation tests pass, and a test proves an imported set cannot be edited. The confirmation before deleting a reviewed set moved to RSET-009 ([ADR 0077](adr/0077-result-sets.md)).
  Depends on PROJ-001, ANN-020.

- [x] RSET-002 · Parfocal JSON schema and validator
  A documented schema with a template to download and a validator in the API and as a command line tool.
  Done when schema tests accept the template and reject each documented error with its line. The help drawer moved to RSET-010.
  Depends on RSET-000. Refs mock: formats, doc 38 answer 7.

- [x] RSET-003 · Readers for GeoJSON, CSV and masks
  GeoJSON including QuPath exports, CSV or TSV of cells or detections with a column-mapping step, and masks and heatmaps as PNG or TIFF aligned to a slide level.
  Done when parser tests read a fixture of each kind into the same object form, including a QuPath export and a CSV with renamed columns. The readers and the object form are in [ADR 0070](adr/0070-result-file-parsers.md), and the fixture must be a real QuPath 0.7 export.
  Depends on RSET-001, RSET-000.

- [ ] RSET-004 · Pairing results with slides
  Results pair with slides on drop by folder shape first (next to the slide or in a folder named like it), then file name, then an embedded slide ID, each with how it was paired and how sure it is (sure, likely). The user can pick another slide in a row, and a result that matches no slide waits until one is picked.
  Done when unit tests cover each pairing rule and a tie, and API tests cover an override and an unpaired result.
  Depends on RSET-001. Refs mock: upload/files.

- [ ] RSET-005 · Import checks and fixes
  Schema and parse errors name the line or feature and offer a downloadable error report and "import the other N". A coordinate or scale mismatch guesses the level or microns per pixel and shows both overlays with the share on tissue. Unknown classes are mapped to project classes once and remembered (PROJ-004). Missing scores count as no score or as 1.0.
  Done when tests cover each problem with fixtures: three objects without a class, a heatmap at level 2 scaled by 4, three new classes, and rows without a score.
  Depends on RSET-003, RSET-004, PROJ-004. Refs mock: upload/check, mock: states/importfail.

- [ ] RSET-006 · Add a result set from the viewer
  On an open slide a file is previewed as an overlay before it is saved, with alignment and scale fixes, and shown next to the existing sets once added.
  Done when E2E adds a GeoJSON from the slide view, fixes its offset and sees it in Layers.
  Depends on RSET-005, VIZ-001. Refs mock: upload/viewer.

- [x] RSET-007 · Reviewed layer
  Reviewer edits (retype, outline, delete, add) are recorded per reviewer in a layer over the AI set, so the AI output is never overwritten and can be compared with what reviewers made of it. Added objects get IDs with a plus (OBJ-003).
  Done when API tests cover each edit, prove the AI set is unchanged, and compare a reviewed layer with its set.
  Depends on RSET-001, OBJ-001, ANN-020.

- [x] RSET-008 · Export reviewed annotations
  Reviewed annotations export as Parfocal JSON and GeoJSON with full IDs, per reviewer or as the consensus after adjudication.
  Done when round-trip tests export and re-import a reviewed layer with no loss.
  Depends on RSET-007, OBJ-001.

- [ ] RSET-009 · Confirm deleting a reviewed result set
  Deleting a result set that a review task or a verdict uses needs `confirm=true`, and the response says how many tasks and verdicts it touches.
  Done when API tests refuse the delete without confirmation when a task uses the set, allow it with confirmation, and allow an unreviewed set without it.
  Depends on RSET-001, TASK-001. Split from RSET-001 by [ADR 0077](adr/0077-result-sets.md).

- [ ] RSET-010 · Help drawer "What files work?"
  The drawer opens from the upload and from an import error, lists the formats that import, links the Parfocal JSON template and schema, and explains the error codes of the validator.
  Done when a component test opens it from both places and shows each format.
  Depends on RSET-002. Split from RSET-002 so the schema and validator have no screen work. Refs mock: formats.

---

## 42 OBJ · Object IDs

IDs short enough to say out loud, scoped to the slide ([ADR 0053](adr/0053-ai-results-review-direction.md), doc 37 "IDs for objects", kit: ID system).

- [x] OBJ-000 · Research check
  Done when an ADR fixes the ID grammar, the full path, the overlap threshold and the split and merge rules.
  Decided in [ADR 0071](adr/0071-object-id-grammar.md). The thresholds are project settings with defaults, because the kit lists them as an open question for the owner.

- [x] OBJ-001 · ID grammar and allocation
  T for AI regions of any class, T2·C145 for a cell inside a region, C for other cells, R for regions of interest, Z for unsure zones and M for measurements, allocated per slide and stable. Cells are numbered once per slide, so T2·C145 and C145 are the same cell. The full path is `P07/S26-04812/A1/T2·C145`, percent-encoded per segment with `~` for a loose slide's case, and `~` is refused as a case label ([ADR 0071](adr/0071-object-id-grammar.md)).
  Done when unit tests cover allocation order, the full path and parsing every form back.
  Depends on OBJ-000, RSET-001.

- [x] OBJ-002 · IDs across result sets
  When a new set arrives on a slide, objects that overlap an existing object above the threshold inherit its ID, new objects get new IDs, and missing ones show as "not in this set".
  Done when tests on two fixture sets cover inherited, new and missing objects.
  Depends on OBJ-001.

- [ ] OBJ-003 · Split, merge and added objects
  Splitting T2 gives T2a and T2b and keeps T2 in the history. Merging T2 and T3 keeps T2 and retires T3 as an alias. Objects a reviewer adds get a plus, as in T6⁺.
  Done when unit tests cover each rule and an alias that still resolves.
  Depends on OBJ-001, RSET-007.

- [ ] OBJ-004 · ID resolution and search
  Any part of a full path resolves to the object, including aliases, for links, search (CASES-009) and the palette (CMD-002).
  Done when API tests resolve every form and an alias after a merge.
  Depends on OBJ-003.

- [ ] OBJ-005 · IDs on the slide and in lists
  ID labels on the slide (switchable in Layers), the object ID tag in every list (DS-008) and copy of the full ID.
  Done when component tests cover labels on and off and copying, and a golden test places labels without overlap on the fixture.
  Depends on OBJ-001, DS-008, VIEW-026.

---

## 43 TASK · Review tasks and the slide pipeline

A researcher hands slides to reviewers as a review task ([ADR 0053](adr/0053-ai-results-review-direction.md), doc 37 "Pipeline").

- [x] TASK-000 · Research check
  Done when an ADR records the slide pipeline (uploaded, AI running or imported, ready, assigned, in review, submitted, disagreement queue, signed off, exported), what is derived and who moves each state.
  Depends on ADAPT-007. Decided in [ADR 0069](adr/0069-slide-pipeline.md).

- [x] TASK-001 · Review task model and API
  A task (RT-14) has a name, a project, slides or cases, a result set, reviewers, a split (everyone reviews all, split evenly, chosen per slide), a scope, an opinion form version, blinding, the start mode (guided or full viewer), a due date and reminders.
  Done when API tests cover create, edit, list and each split, with isolation and audit.
  Depends on PROJ-003, RSET-001, TASK-000. A task refuses a result set that is not `ready` or is deleted ([ADR 0077](adr/0077-result-sets.md)).
  A project reviewer reads only the slides of their tasks, so this task extends `project_access.readable` and the case check with task slides ([ADR 0065](adr/0065-project-role-enforcement.md)).

- [x] TASK-002 · Slide states per task and reviewer
  Each slide in a task moves through the pipeline per reviewer, with derived states (imported, ready) and states people move (submitted, signed off), each transition audited. One pure function derives the states from stored facts, and only submit, reopen, sign-off and task reopen are stored moves ([ADR 0069](adr/0069-slide-pipeline.md)).
  Done when a table-driven test covers every allowed and refused transition with its actor.
  Depends on TASK-001.

- [x] TASK-003 · Scope and progress
  Scopes are all regions, a random N cells per slide that is the same for every reviewer, cells below a score, objects inside ROIs, and unsure zones. Progress counts against the scope, as in 37 of 50 sampled cells.
  Done when unit tests prove the sample is deterministic and shared, and progress counts match on a fixture.
  Depends on TASK-001, OBJ-001.

- [ ] TASK-004 · Blinding and first read
  Reviewers see others' verdicts and comments only after they submit. A project can hide the AI for a first read and reveal it afterwards. The researcher sees everything.
  Done when permission tests cover each role before and after submit, and API tests show the AI hidden before a first read, shown after it, and the first read kept unchanged.
  Depends on TASK-002, GUIDE-001. The first read is a stored step that is never changed, and the AI is hidden from a project reviewer on that slide until it is recorded ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md)).
  Split on 2026-10-31: the E2E that reveals the AI after a first read moved to TASK-010, because it needs the review screens.

- [ ] TASK-005 · New review task stepper
  A medium one-column stepper with Slides, Reviewers, What to check, How and when, and Send. Reviewers are picked in the token field (DS-020). The estimate follows every choice. Send shows a summary with a Change link per row and the email the reviewers receive.
  Done when component tests cover each step and the estimate, and E2E creates a task from the project page and from the end of an upload.
  Depends on TASK-001, DS-020, DS-022. Refs mock: task, doc 39.

- [ ] TASK-006 · Invitations to a task
  Inviting someone new to a task sends an email without PHI that names who asked, the project, the work and the due date. Accepting creates the account and opens the first slide (ONB-003).
  Done when API and E2E tests cover invite, accept and landing on the first slide.
  Depends on TASK-001, IAM-007, NOTIF-004.

- [ ] TASK-007 · Nudge, reassign and change a task
  The researcher nudges reviewers who are behind, reassigns slides, adds a reviewer and changes the due date, each audited and notified.
  Done when API tests cover each action and E2E nudges from Assigned by me.
  Depends on TASK-001, NOTIF-001. Reassigning never drops a recorded first read ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md)).

- [ ] TASK-008 · Submit a slide review
  Submitting shows what will be sent (verdicts by kind and the opinion), saves the review and opens the next slide. A submitted review can be reopened by its reviewer until sign-off.
  Done when E2E submits, reopens and submits again, and the next slide opens.
  Depends on TASK-002, GUIDE-007, CASES-020. Refs mock: next. In a task that hides the AI, the first read comes before submit and the API answers `first-read-needed` without it ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md)).

- [ ] TASK-009 · Study template in a new review task
  The first step of a new review task asks for the study template, with the project's default picked. The template fills what to check, the opinion form and how and when, and each step marks what came from the template. Changing a preset keeps the template for the report. The summary names the template ([ADR 0097](adr/0097-report-templates-built-from-blocks.md)).
  The API only records the pinned version, so the stepper fills the steps from the presets itself, and a template with its own opinion form questions publishes them as the project's next form version first ([ADR 0120](adr/0120-study-templates-are-workspace-rows-and-tasks-only-pin-them.md), study templates as workspace rows that a task only pins).
  Done when component tests show each step filled from two different templates and a changed preset kept, and E2E creates a task from a template and finds its blocks in the report.
  Depends on TASK-005, EVAL-007. Refs mock: task, doc 43.

- [ ] TASK-010 · Reveal the AI after a first read, end to end
  In a task that hides the AI, a reviewer opens a task slide and sees no AI objects, answers the opinion form, adds an object they found, records the first read, sees the AI appear, gives verdicts and submits. Their first read stays as it was recorded.
  Done when E2E walks that flow and checks that the AI is absent before the first read and present after it, and that the first read is unchanged after the verdicts and the submit.
  Depends on TASK-004, GUIDE-002, GUIDE-007. Split from TASK-004 ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md)).

---

## 44 GUIDE · Verdicts, guided review and the opinion form

Doctors judge AI objects in a simple guided mode, or in the full viewer with the same keys ([ADR 0053](adr/0053-ai-results-review-direction.md), doc 37 "Doctors first").

- [x] GUIDE-000 · Research check
  Done when an ADR records the verdict model, the disagree reasons per object kind and the opinion form schema.
  Decided in [ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md).

- [x] GUIDE-001 · Verdict model and API
  Agree, Disagree or Not sure per object and reviewer, a reason on Disagree, saved at once, changeable until sign-off, and audited.
  Done when API tests cover each verdict, a change, a refused change after sign-off and the audit entry.
  Depends on OBJ-001, TASK-002.

- [ ] GUIDE-002 · Guided review
  One object at a time with a plain question ("Is T2 tumor?"), what the AI said in a 16 px line, and Agree, Disagree and Not sure as large buttons with K, X and U. It moves on by itself, zooms the slide to the object, allows drag and zoom with Back to the object and Whole slide, and shows progress dots with a check, a cross or a question mark. My work is one click away, and the Guided and Full viewer switch keeps one review.
  Done when E2E reviews a slide by mouse and by keyboard only, unit tests cover the auto-advance, and a test proves the dots carry a glyph per state.
  Objects come in the task's review order (GUIDE-012).
  Depends on GUIDE-001, VIEW-020, GUIDE-012. Refs mock: guided, doc 38, doc 40 G1, G3 and G5.

- [ ] GUIDE-003 · Disagree reasons and optional fixes
  Disagree asks what is wrong with four quick reasons per object kind, coded as [ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md) lists. Redrawing the outline or changing the type is optional.
  Done when component tests cover reasons for a region and a cell, and E2E redraws an outline from guided review.
  Depends on GUIDE-002, RSET-007. Refs mock: guided/disagree.

- [ ] GUIDE-004 · Undo after a verdict
  Every verdict shows what was recorded with an Undo (DS-021), which restores the verdict and the position.
  Done when E2E undoes a verdict on the last object of a slide and the slide is open again.
  Depends on GUIDE-002, DS-021. Refs doc 40 G2.

- [ ] GUIDE-005 · Verdicts in the full viewer
  K, X and U act on the selected object in the full viewer, and the Objects tab lists IDs with verdicts.
  Done when E2E gives the same verdicts in both modes and sees one review.
  Depends on GUIDE-001, CASE-014.

- [x] GUIDE-006 · Opinion form builder
  The researcher builds a short form per project from a default template (acceptable 1 to 5, main error type, a free comment), with scale, choice, yes or no and text questions, versioned.
  Done when API tests cover each question kind and a new version leaving old answers intact.
  Depends on PROJ-001.

- [ ] GUIDE-007 · Opinion form for the reviewer
  Three quick questions when a slide is done in guided review, and the whole form in the Opinion tab, saved as a draft.
  Done when component tests cover each question kind and E2E answers in guided review and finds the answers in the tab.
  Depends on GUIDE-006, GUIDE-002, GUIDE-009. Refs mock: opinion, mock: guided/done.

- [ ] GUIDE-008 · How this works
  A first-time coach in guided review with four numbered tips, reopened from How this works.
  Done when component tests cover the coach and its dismissal per user.
  Depends on GUIDE-002. Refs mock: guided/first.

- [x] GUIDE-009 · Opinion answers API
  One opinion per task, reviewer and slide on the form version the task pinned, saved as a draft by merging answers, checked against each question's kind, locked once the slide is submitted until it is reopened, and audited without the answers. The reviewer and project owners read it.
  Done when API tests cover every question kind, a merge, a refused answer, the pinned version, the lock after submit and the roles.
  Depends on GUIDE-006, TASK-002. Split out of GUIDE-007 so the screen has no backend work.

- [ ] GUIDE-010 · Notes on verdicts
  After any verdict, in guided review, the full viewer and the cell view, an "Add a note" link and the N key open a short field with Save on Enter and Cancel on Esc. Disagree and Unsure offer their quick reasons as toggles before the text, and none is required. A saved note shows the reviewer as avatar and name, the verdict, the reasons and the text with Edit, can mention people as comments do, and never blocks moving on. Notes show as a thread on the object in the Comments tab, and under each reviewer's verdict in the disagreement queue and the adjudicator view, blinded there ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)).
  Done when component tests cover writing, editing and cancelling a note with each verdict, E2E adds a note with a mention in guided review and finds it in the full viewer's Comments tab and in the adjudicator view, and an axe check passes on the open field.
  Depends on GUIDE-011, GUIDE-002, GUIDE-005, COLLAB-005, COLLAB-006. Refs mock: guided/note, mock: case, doc 42.

- [ ] GUIDE-011 · Optional and several reasons, reasons on Unsure
  The verdict API takes zero or more reason codes on Disagree instead of exactly one, and Unsure takes the optional codes `need_deeper_level`, `need_ihc`, `border_unclear` and `out_of_focus`. Existing verdicts keep their single reason as a set of one. The evaluation report counts each code of a verdict once ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md), amending [ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md)).
  Done when API tests cover Disagree with no reason and with several, Unsure with a code, a refused Agree with a code and the migrated rows, and EVAL tests count several codes per verdict.
  Depends on GUIDE-001, EVAL-001.

- [x] GUIDE-012 · Least sure first order
  The thesis assignment promises a review that starts with the outputs the model is least sure of ([ADR 0114](adr/0114-thesis-assignment-tasks.md)). Each reviewer's objects in a task come in ascending order of the model's certainty: the calibrated probability of the AI class where the result set has one, else its score. Ties break by object ID. Objects without a score come after the scored ones in the task's fixed random order (TASK-003), so imported outputs without scores are still reviewed in an order every reviewer shares. Regions are few and all of them are checked, so the order matters most for cells. The order is computed once per task and stored, so a later recalibration does not reshuffle a running review.
  Done when unit tests cover the order on a fixture with known scores, ties, a set without scores and a mixed set, and API tests show two reviewers getting the same order and a recalibration leaving a running task unchanged.
  Depends on TASK-003, GUIDE-001. Refs doc 33 (showing type confidence to a doctor), doc 28 (calibrated type confidence).
  The order covers the regions and cells in the task's scope and is stored as one packed array per task slide in `review_order` when the task is made ([ADR 0117](adr/0117-review-order-is-stored-per-task-slide.md), review order stored per task slide). Cells are read from their chunk files through the result store. A cell's certainty is its chunk's probability for its AI class, and a chunk without probabilities gives unscored cells rather than falling back to the detection score, because the chunk format cannot mark a score as missing.

- [ ] GUIDE-013 · Review order as a background job
  Storing the least sure first order reads every chunk file of a cell scope inside the request that creates or rescopes a task ([ADR 0117](adr/0117-review-order-is-stored-per-task-slide.md), review order stored per task slide). For real slides this moves onto the Postgres job engine ([ADR 0044](adr/0044-background-jobs-and-workflows.md), background jobs and workflows): the task is created at once, a job computes each slide's order, and the order route answers that the order is not ready until it is.
  Done when API tests create a cell scope task, see the order reported as not ready, run the job and read the same order the inline path gives, and a test shows a failed job retried without a duplicate order.
  Depends on GUIDE-012, INGEST-003.


---

## 45 ADJ · Disagreements, adjudication and sign-off

- [x] ADJ-000 · Research check
  Done when an ADR records the disagreement rule (reviewers differ, or all differ from the AI above a threshold) and what sign-off locks, including when sign-off is allowed ([ADR 0069](adr/0069-slide-pipeline.md) left that open for the owner).
  Decided by the owner in [ADR 0080](adr/0080-disagreement-rule-and-sign-off.md): reviewers differ or more than half disagree with the AI, and sign-off needs every slide submitted and no undecided object.

- [x] ADJ-001 · Disagreement detection
  When every reviewer has submitted, objects where reviewers differ, or where more than half of them disagree with the AI, go into a queue per task ([ADR 0080](adr/0080-disagreement-rule-and-sign-off.md)).
  Done when unit tests cover both kinds on a seeded task.
  Depends on GUIDE-001, TASK-002.

- [ ] ADJ-002 · Disagreement queue
  A list filtered by all, reviewers differ and both against the AI, the object with the AI's call and each reviewer's verdict side by side, and two decisions, keep the AI's call or go with the reviewers. Editing the object and asking an adjudicator are links under them, and a note can be added. Decisions sit next to the verdicts and never replace them.
  Done when component tests cover each filter and decision, and E2E resolves a queue.
  Depends on ADJ-001, ADJ-006. Refs mock: disagree, doc 40 D7.

- [ ] ADJ-003 · Adjudicator view
  The adjudicator gets the guided one-object view with the reviewers anonymous.
  Done when E2E adjudicates a sent object and the researcher sees the decision.
  Depends on ADJ-002, GUIDE-002. Refs mock: disagree/adjudicate.

- [ ] ADJ-004 · Sign-off as a soft lock
  Before signing, a list says what is complete. Signing is allowed only when every assigned reviewer has submitted every slide and no queued object is undecided ([ADR 0080](adr/0080-disagreement-rule-and-sign-off.md)). Signing confirms with single sign-on, makes Evaluation v1 with a checksum and notifies reviewers. The owner can still change things, every change is logged, and reopening is possible.
  Signing also stores the report's block list (EVAL-008).
  Done when API tests cover signing, a change after sign-off with its log entry and reopening, and E2E signs off a task.
  Depends on ADJ-002, IAM-002. Refs mock: signoff, doc 40 R2.

- [ ] ADJ-005 · Changes after sign-off
  The log of changes after sign-off with who, when and what, flagged in the evaluation report.
  Done when API tests list the changes and the report shows the flag.
  Depends on ADJ-004, EVAL-002.

- [x] ADJ-006 · Decisions on queued objects
  The researcher or an adjudicator decides a queued object: keep the AI's call or go with the reviewers, with an optional note. A decision sits next to the verdicts, can be changed until sign-off, removes the object from the open count and is audited.
  Done when API tests cover each decision, a change, a refused change after sign-off, the open count and the audit entry.
  Depends on ADJ-001. Split from ADJ-002 by [ADR 0084](adr/0084-evaluation-metrics.md).


---

## 46 EVAL · Evaluation report, study templates and exports

The research output of a review task ([ADR 0053](adr/0053-ai-results-review-direction.md)).

- [x] EVAL-000 · Research check
  Done when an ADR defines the metrics (sensitivity, precision and Dice for regions against the consensus, Cohen's kappa between reviewers, cell agreement) and confirms the PDF choice (STACK-035).
  Decided in [ADR 0084](adr/0084-evaluation-metrics.md), with the PDF in [ADR 0083](adr/0083-typst-for-report-pdfs.md).

- [x] EVAL-001 · Metrics engine
  Computes the metrics from verdicts, decisions and the reviewed layers per task, as [ADR 0084](adr/0084-evaluation-metrics.md) defines them.
  Done when unit tests reproduce hand-computed values on a fixture task.
  Depends on EVAL-000, ADJ-006.

- [ ] EVAL-002 · Evaluation report page
  The report shows as its pages, the same pages as the PDF (EVAL-008), under a header with the Research output tag, the version, the page count and a flag for changes after sign-off. A side panel picks the study template, opens the PDF preview (EVAL-010), starts Arrange (EVAL-009) and offers the downloads the template allows. The blocks of the sentinel node template are the headline numbers, the confusion matrix with axis titles, the disagreement reasons sorted by size, the opinion answers, and the objects that went worst with a column header per reviewer.
  Done when component tests render a seeded report and axe passes.
  Depends on EVAL-001, EVAL-006. Refs mock: evaluation, doc 40 D8 and E1.

- [ ] EVAL-003 · Exports
  PDF in the task's block order, verdicts per object as CSV with full IDs, the objects as CSV, and annotations as JSON and GeoJSON (RSET-008), each with the checksum of the evaluation version.
  Done when tests check every export's columns and counts and the PDF text.
  Depends on EVAL-002, RSET-008.

- [ ] EVAL-004 · Compare two evaluations
  Two result sets of the same slides side by side, for example CAMELYON against PathoSAM.
  Done when component tests render a comparison of two seeded tasks.
  Depends on EVAL-002.

- [ ] EVAL-005 · Read-only link for co-authors
  A link to the report without slides, revocable and logged.
  Done when API tests cover the link, revocation and the log.
  Depends on EVAL-002.

- [x] EVAL-006 · Task evaluation API
  An endpoint that gathers a task's verdicts, decisions, reviewed layers, added objects, region areas (with PostGIS) and opinion answers into the EVAL-001 engine and returns every metric with its counts.
  Done when API tests return the expected metrics for a seeded task, refuse reviewers and pass isolation.
  Depends on EVAL-001. Split out so EVAL-002 (evaluation report page) has no backend work.

- [ ] EVAL-007 · Study template model and API
  A study template has a name, a kind of study, an ordered list of blocks from the catalogue with their settings, and task presets (objects to check, opinion form, blinding, first read, start mode, split). Templates are versioned per workspace, the five built-in ones (detection, segmentation, cell typing, reader study, sentinel node AI evaluation) are seeded, and a task pins a version. Researchers read and use templates, and only researchers with admin rights create, edit and retire them ([ADR 0097](adr/0097-report-templates-built-from-blocks.md)).
  Done when API tests cover create, edit as a new version, retire, the seeded five, a task pinning a version, a refused unknown block kind or setting, isolation and the audit entry.
  Depends on TASK-001, GUIDE-006, IAM-024. Refs [ADR 0120](adr/0120-study-templates-are-workspace-rows-and-tasks-only-pin-them.md) (study templates as workspace rows that a task only pins).

- [ ] EVAL-008 · Report from template blocks
  The report page (EVAL-002) and the Typst PDF (EVAL-003) render the task's block list and format from the evaluation JSON, one component and one Typst function per block kind. The page splits the blocks into pages the way the PDF does, honouring half widths, page breaks, the paper, orientation, text size, header, footer, page numbers, watermark, signature, language of labels, decimals and appendices. A block with nothing to show says why. Sign-off (ADJ-004) stores the block list with the evaluation version, so a signed report renders as it was signed.
  Done when component tests and PDF text tests render every block kind on a seeded task, a test shows the PDF and the page list the same blocks in the same order, and a signed report keeps its layout after the template changes.
  Depends on EVAL-007, EVAL-006, STACK-035.

- [ ] EVAL-009 · Arrange one report
  On the report page, Arrange turns the pages into the editor of ADMIN-008 with the Block and Page and format tabs: blocks are dragged onto the pages or clicked in, selected on the page with a toolbar to move, duplicate and remove, and set in the side panel. Changes belong to this task, never to the template, and Save as template sends the arrangement to the library for someone with admin rights to accept. After sign-off a layout change is logged like any change.
  Done when component tests cover adding, moving, removing and setting a block, and E2E arranges a report, exports the PDF in the new order and saves it as a template.
  Depends on EVAL-008, EVAL-002, ADJ-005. Refs mock: evaluation/arrange, doc 43.

- [ ] EVAL-010 · PDF preview
  Preview the PDF opens the file the export would download, rendered by the Typst worker as SVG pages, in a viewer with the file name, paper and page count, page thumbnails that jump to a page, the current page, zoom, Print, Download and Close. It opens from the report page, from the template list and editor with the sample project's numbers, and from the template step of a new review task ([ADR 0097](adr/0097-report-templates-built-from-blocks.md)).
  Done when component tests cover thumbnails, the page indicator while scrolling, zoom and closing, an API test returns the same pages as the PDF export for a seeded task, and E2E opens the preview from the report and from a template.
  Depends on EVAL-008, STACK-035. Refs mock: evaluation/pdf, mock: admin/templates, doc 43.


---

## 47 JOBS · Model runs, the jobs tray and lab models

- [ ] JOBS-000 · Research check
  Done when an ADR records the model run contract with Parfocal and lab endpoints, building on AIP-008.
  Depends on AIP-000.

- [ ] JOBS-001 · Model run API
  Run a Parfocal or lab model on chosen slides. The latest version is used and recorded. Each slide gets a new result set. The estimate uses measured throughput (AIP-011) and the queue ahead.
  Done when API tests cover a run, its result sets and the estimate.
  Depends on AIP-008, RSET-001.

- [ ] JOBS-002 · Run a model window
  A small window in three parts: the slides as a token field with the slides without results picked, one model dropdown grouped into Parfocal's models and the lab's models with what each makes and its time per slide, and what happens (the result set name, the time with the expected finish and a notification). No version picker. It opens from the project, a slide's menu and the end of an upload.
  Done when component tests cover each part and the estimate, and E2E runs a model from the upload's end.
  Depends on JOBS-001, DS-020. Refs mock: runmodel, doc 39.

- [ ] JOBS-003 · Jobs tray
  A ring in the top bar with the number running opens a list of running and finished uploads and runs. Each row opens its steps.
  Done when component tests cover the states and E2E opens an upload and a run from the tray.
  Depends on JOBS-001, DS-019. Refs mock: upload/tray, doc 41.

- [ ] JOBS-004 · Job window with steps per slide
  One bar for the run, then each slide with its steps (queued, tiles read, tissue found, model running, objects placed, IDs given, result set added). A slide opens once its objects are placed. A paused run says why and offers Resume or Move it to the Parfocal GPU. Cancel keeps what is finished and offers an Undo. Close keeps the run going.
  Done when component tests cover running, paused and finished runs, and E2E cancels and undoes a run.
  Depends on JOBS-003, AIP-011, DS-021. Refs mock: job, doc 41.

- [ ] JOBS-005 · Connect a lab model
  A researcher with admin rights points Parfocal at the lab's HTTP endpoint (MONAI Label, Triton or any service following the Parfocal contract) with its authentication, tile size and magnification, tests it with a sample tile, maps its classes and chooses who can run it. The endpoint follows the address rules of INGEST-025 when saved and on every call, follows no redirects, keeps its credentials sealed with the tenant data key, and lists the projects that may use it ([threat model](security/threat-model.md) J1 to J3).
  Done when API tests cover a passing and a failing test call and the class map, and E2E connects a stub endpoint.
  Depends on JOBS-001, PROJ-004. Refs mock: admin/addmodel, doc 39.

- [ ] JOBS-006 · Show or hide Parfocal models
  Parfocal's models are always listed unless a researcher with admin rights hides one. A hidden model leaves every model list and its result sets stay. Hiding shows an Undo.
  Done when API tests cover hiding and E2E hides a model and finds it gone from Run a model.
  Depends on JOBS-001, DS-021. Refs mock: admin/models, doc 40 R1.

---

## 48 REMOTE · Remote sources, webhooks and events

- [ ] REMOTE-000 · Research check
  Done when an ADR records read in place with a tile cache, the webhook signature and the event delivery guarantees.
  Depends on INGEST-026.

- [ ] REMOTE-001 · Read in place from a connected source
  A connected source is browsed like a folder. Read in place streams tiles on demand and copies nothing, with a 7-day tile cache, a remote tag on the slide and an offline state that opens from the cache. Copy into Parfocal copies once. Result files next to a slide are always imported. Slides get their storage (uploaded or the connected source), and My work's All slides gains the storage filter ([ADR 0082](adr/0082-my-work-query-api.md)). Source credentials are sealed with the tenant data key and source addresses follow the rules of INGEST-025 ([threat model](security/threat-model.md) T5).
  Done when E2E opens a remote slide, a test serves tiles from the cache with the source down, and a copy keeps IDs and reviews.
  Depends on REMOTE-000, TILES-001. Refs mock: upload/remote, mock: states/remoteoff.

- [ ] REMOTE-002 · Webhook in per project
  A signed URL per project takes a slide link, result links, a case ID and optionally a task, answers what was done, and logs every call.
  Done when API tests cover a valid call, a bad signature and the log.
  Depends on REMOTE-000, INGEST-025, RSET-005. Refs mock: upload/webhook.

- [ ] REMOTE-003 · Events out
  Parfocal calls a pipeline back when a review is submitted, a task has disagreements, a task is signed off or a result set is added, signed, retried and logged. A failed delivery is an `integration-down` target that the notification resolver opens ([ADR 0091](adr/0091-notification-catalogue-and-targets.md)).
  Done when tests deliver each event, retry after a failure and prove the signature.
  Depends on REMOTE-000. Refs mock: upload/events.

- [ ] REMOTE-004 · Watched folder or bucket
  New files in a watched folder or bucket arrive in a project, checked like an upload.
  Done when a test drops files in a bucket fixture and they arrive.
  Depends on REMOTE-001. Refs mock: upload/watch.

---

## 49 ONB · Sign-up, setup and the sample project

- [ ] ONB-000 · Research check
  Done when an ADR records the sign-up and setup flow on top of IAM-002 and IAM-007.

- [ ] ONB-001 · Sign-in screens
  Parfocal with the workspace logo, single sign-on first when the email domain matches, email and password, a sign-in link with a code, and forgot password with a reset checked for length, reuse and leaks. A deep link lands on its target after sign-in.
  Done when E2E covers each path and the deep link.
  Depends on IAM-002. Refs mock: signin.

- [ ] ONB-002 · Sign-up and email confirmation
  Name, work email, password or single sign-on, and what the person mostly does, then a one-time code.
  Done when E2E signs up, confirms and reaches setup.
  Depends on ONB-001. Refs mock: signup.

- [ ] ONB-003 · Invite landing
  Who invited, the project and task, the work, the due date, blinding and the privacy mode, then join in one step and open the first slide.
  Done when E2E accepts an invite and lands on the first slide.
  Depends on TASK-006. Refs mock: invite.

- [ ] ONB-004 · First-run setup
  Five skippable steps whose choices carry through: role and specialties (the role sets the recommended first project and the checklist), the workspace (join, ask or create with a name, logo and default privacy), the first project (sample, create or wait), the input device and the theme (applied at once), and a checklist that ends in the chosen place.
  The person who creates a workspace becomes a researcher with admin rights, whatever they picked as their role, and setup says so ([ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md)).
  Done when component tests cover each choice and its effect, E2E finishes setup into each of the three first-project choices, and an API test shows the creator of a workspace holds admin rights.
  Depends on ONB-002, ONB-005, IAM-024. Refs mock: setup, doc 41.

- [ ] ONB-005 · Sample project
  A new workspace gets a sample project with 4 CAMELYON16 slides, two result sets and a review task for the person, deletable and left out of every evaluation.
  Done when API tests seed and delete it, and an evaluation test proves it is excluded.
  Depends on PROJ-001, RSET-001, TASK-001.

- [ ] ONB-006 · Getting-started checklist
  On Home until each item has been tried once, and hideable.
  Done when component tests tick items from real events.
  Depends on ONB-004, HOME-002. Refs mock: home/new.

---

## 50 ADMIN · Admin page

Admin is its own page with its own sidebar and the app's top bar, never a page inside a page (doc 39). Researchers with admin rights open it, and nobody else sees it ([ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md)).

- [ ] ADMIN-000 · Research check
  Done when the admin sections and their permissions are listed in an ADR. Who opens the page is settled by [ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md).

- [ ] ADMIN-001 · Admin page shell
  A sidebar with Back to Parfocal, the workspace and the sections (overview, people and roles, projects, AI models, report templates, storage and sources, API and webhooks, audit log, security), and flat content.
  Done when component tests cover navigation and permission tests refuse reviewers and researchers without admin rights.
  Depends on SHELL-001, IAM-024. Refs mock: admin.

- [ ] ADMIN-002 · Overview
  Stat tiles and a short summary per section. Storage shows the same split bar as ADMIN-006 in a compact size.
  Done when component tests render seeded data.
  Depends on ADMIN-001.

- [ ] ADMIN-003 · People and roles
  People with a role dropdown (researcher or reviewer), an admin rights switch on researchers, projects, last active and status, with invite, resend and search (IAM-014). Above the list, a table states what each role and admin rights are responsible for, in the words of ADR 0096.
  Done when E2E changes a role, gives and removes admin rights and resends an invite, each audited, and a component test shows the switch disabled for the last holder and absent on reviewers.
  Depends on ADMIN-001, IAM-014.

- [ ] ADMIN-004 · Projects
  Every project with its privacy mode, owner, size and status, with archive.
  Done when component and API tests cover archiving.
  Depends on ADMIN-001, PROJ-001.

- [ ] ADMIN-005 · AI models
  Parfocal models with the Shown switch (JOBS-006), the lab's models (JOBS-005) and running jobs with Cancel and Undo.
  Done when E2E hides a model and cancels a run with undo.
  Depends on ADMIN-001, JOBS-005, JOBS-006.

- [ ] ADMIN-006 · Storage, sources, API and webhooks
  Connected sources and their state (REMOTE-001), API tokens (IAM-011) and webhooks (REMOTE-002, REMOTE-003). Space is one bar split by kind (copied slides, tile cache for remote slides, results and reviews, free) with a legend and sizes, slides read in place as a line under it, and a by-project list largest first. The colours differ in lightness and avoid the tumor red ([ADR 0095](adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md)).
  Done when an API test checks the space per kind and per project adds up to the total, component tests render the bar with seeded usage including an empty workspace and a nearly full one, and E2E creates and revokes a token.
  Depends on ADMIN-001, REMOTE-002, IAM-011.

- [ ] ADMIN-007 · Audit log and security
  The audit log with filters and a signed export (SEC-024), and the security settings (single sign-on, session policy, MFA).
  Done when E2E filters and exports the log.
  Depends on ADMIN-001, SEC-024.

- [ ] ADMIN-008 · Report templates
  The workspace's study template library: the five built-in templates and the lab's own, each with its kind of study, its blocks as a strip, the tasks that use it and its version, with Preview, Duplicate or Edit, Use for new projects and Retire with an Undo. New template asks for a name, the kind of study, what to start from and the paper. The editor shows the report as its pages filled with the sample project's numbers. Blocks are dragged from the catalogue onto a page or clicked in after the selected block, a selected block has a toolbar to move, duplicate and remove it, and the side panel has three tabs. Block holds the title, showing the title, full or half width, a page break and the fields of that kind of block. Page and format holds the paper (A4 or US Letter), orientation, text size, workspace logo, title and subtitle with placeholders, running header, page numbers, draft watermark, signature block, language of labels, decimals, appendices and the downloads offered. Task presets hold the objects to check, opinion form, blinding, first read, start mode and split ([ADR 0097](adr/0097-report-templates-built-from-blocks.md)).
  Done when component tests cover adding a block by drag and by click, moving, duplicating, removing and setting each kind of block, and every format setting, with the mouse and the keyboard, E2E creates a template, previews its PDF, uses it in a review task and retires it, and an axe check passes on the editor.
  Depends on ADMIN-001, EVAL-007. Refs mock: admin/templates, mock: admin/tpledit, doc 43.

---

## 51 VIZ · Layers and visualization

- [ ] VIZ-000 · Research check
  Done when an ADR records how result sets, styles and maps are drawn on the overlay system (VIEW-026).

- [ ] VIZ-001 · Result sets in the Layers tab
  Each result set is a row with show or hide, colour and opacity, and a menu to compare, run again or add another. The person's review is its own row.
  Done when component tests cover each control and E2E hides a set.
  Depends on RSET-001, VIEW-026. Refs mock: layers, doc 38 answer 2.

- [ ] VIZ-002 · Classes and style
  Per class visibility with counts and keys, draw as outline, fill or dots, colour by class, score or verdict, ID labels and a score cutoff that filters objects live.
  Done when golden tests cover each style and a test proves the cutoff hides objects below it.
  Depends on VIZ-001, VIEW-027.

- [ ] VIZ-003 · Heatmap, density and confidence maps
  Each with its ramp and a threshold. The heatmap is drawn at 30% by default so the tissue shows through.
  Done when golden tests cover each map and the default opacity.
  Depends on VIZ-001, AITUM-002. Refs mock: layers/heat, doc 40 G4.

- [ ] VIZ-004 · Diff and agreement
  AI against reviewed, model A against B and reviewer against reviewer, coloured by agreement and also drawn differently (dashed for AI only, double for reviewer only), so colour is never the only cue.
  Done when golden tests cover each comparison and a test proves each kind has a non-colour cue.
  Depends on VIZ-001, OBJ-002. Refs mock: layers/diff, doc 40 G1.

- [ ] VIZ-005 · Swipe and side by side
  A swipe line and a side-by-side split between two sets.
  Done when E2E drags the swipe and both halves stay in sync.
  Depends on VIZ-004, CMP-002.

- [ ] VIZ-006 · Object table and stats
  A table of ID, class, score, size and verdict that stays in sync with the slide, with counts and histograms and a CSV download.
  Done when component tests sync a selection both ways and a test counts the CSV rows.
  Depends on VIZ-001, OBJ-005. Refs mock: layers/table.

---

## 52 ADAPT · Reverting or reworking the built hospital code

Code built for the hospital direction is reverted or reworked so nothing runs that the product does not use ([ADR 0053](adr/0053-ai-results-review-direction.md)). The ticked tasks that built it stay ticked as history. Each task supersedes the ADR it undoes, regenerates the permission doc and the data map, updates the OpenAPI client, and keeps the isolation suite green. Hospital tasks that remain ideas can be rebuilt from git history if they come back.

- [x] ADAPT-000 · Inventory and plan
  List every endpoint, table, column and permission the hospital tasks added (migrations `0005`, `0010`, `0012` to `0019`, `apps/api/src/parfocal_api/` modules `cases`, `case_creation`, `case_states`, `accessions`, `folders`, `folder_access`, `routing`, `signing`, `availability`, `emergency`, `permissions`), mark each as kept, reworked or reverted, and order the work so each step leaves `main` green.
  Done when an ADR holds the table and the order, and the owner has accepted it. STACK-040 (FHIR) added no code and needs no change.
  Refs [ADR 0053](adr/0053-ai-results-review-direction.md), ADR 0026, 0032, 0036, 0037, 0038, 0046, 0047, 0051. Planned in [ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md).

- [x] ADAPT-001 · Remove hospital-only permissions, grants and the guest scope
  Remove the permissions that only served sign-out (cancel, take and reassign cases, order lab work, draft, sign out, co-sign and amend reports, ask for and give second opinions, share reports, tumor boards, approve models), the grants needs co-sign, as named supervisor, shared with them and measure and comment, the outside consultant column, `GuestPrincipal`, `GuestGrant`, `ActorKind.GUEST`, the case and view settings in `DatabaseScope` and the `guest_case_scope` and `guest_hidden` policies. The five membership roles stay until IAM-022 replaces them. The code is throwaway, so migrations are edited in place ([ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md)).
  Done when the table-driven permission test runs the smaller matrix on every endpoint, the permission doc is regenerated, no guest code or policy is left and the isolation suite passes.
  Depends on ADAPT-002, ADAPT-003, ADAPT-007.

- [x] ADAPT-002 · Revert folders
  Remove folders, folder members, the folder on a case, `all_folders` on the membership, the "in their folders" grant and folder-scoped permissions (`folders.py`, most of `folder_access.py`, migrations `0016` and `0017`). Until project roles (PROJ-003) land, members see every case their role allows in the workspace. The emergency path keeps working for administrators.
  Done when the migrations are gone, the isolation suite passes without the tables, no endpoint refers to folders, and an ADR supersedes ADR 0046.
  Depends on ADAPT-000.

- [x] ADAPT-003 · Revert signing rights and supervision
  Remove "signs alone", the supervisor and the stored signature image (`signing.py`, migration `0010`). Sign-off confirms with single sign-on (ADJ-004), and supervision and co-sign stay ideas.
  Done when the columns and endpoints are gone, no code reads them, and an ADR supersedes ADR 0032.
  Depends on ADAPT-000.

- [x] ADAPT-004 · Rework cases for projects
  Create the minimal `projects` and `project_members` tables that [ADR 0062](adr/0062-project-model.md) names, including the privacy mode and the project number. A case belongs to a project and is optional, and a slide belongs to a project with an optional case. The case ID is free text unique within the project, the patient link is optional and allowed only in clinical projects, and the columns priority, due time, assignee, clinical note, clinical question and requester are dropped. The source loses `lis`. Specimen and blocks stay optional (`cases.py`, migration `0012`). Existing rows need not survive ([ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md)).
  Done when API tests cover cases in both privacy modes and a loose slide, isolation tests pass, and an ADR updates ADR 0036.
  Depends on PROJ-000, ADAPT-002, ADAPT-006, ADAPT-007.

- [x] ADAPT-005 · Rework case creation
  Creating a case takes a project, an ID and an optional specimen, with patient fields only in a clinical project. Drafts, service, AI plan and the rule hooks in `case_creation.RULES` go (`case_creation.py`, migration `0015`). Idempotency per request key stays.
  Done when API tests cover creation in each privacy mode and idempotency, and no rule hook is left.
  Depends on ADAPT-004.

- [x] ADAPT-006 · Revert accession numbers
  Remove the per-workspace templates and counters (`accessions.py`, migration `0013`). Case creation takes a typed case ID, unique within the workspace until ADAPT-004 makes it unique within the project. Later the ID can also come from file names (CASES-024).
  Done when the tables and endpoints are gone, a uniqueness test passes, and an ADR supersedes ADR 0037.
  Depends on ADAPT-000.

- [x] ADAPT-007 · Revert the case state machine
  Remove the case states, their history columns, cancel and restore, and the state filter on the case list (`case_states.py`, migration `0014`, the `state` column from `0012`). The slide pipeline per task (TASK-002) replaces them and may reuse its table-driven test pattern.
  Done when the columns and endpoints are gone, no code reads a case state, and an ADR supersedes ADR 0038.
  Depends on ADAPT-000.

- [x] ADAPT-008 · Revert case routing rules
  Remove assignment by folder, specimen and load (`routing.py`). Researchers assign reviewers in a task. Nothing calls the module.
  Done when the module and its tests are gone and nothing calls it.
  Depends on ADAPT-000.

- [x] ADAPT-009 · Rework availability
  Keep "away until" with an optional note, shown when picking reviewers in a task. Remove busy, the back-up and the routing of new cases to it (`availability.py`, `availability.covering` in case creation, migration `0019`).
  Done when API tests cover the status and its expiry, the back-up column is gone, and an ADR supersedes ADR 0051.
  Depends on ADAPT-000.

- [x] ADAPT-010 · Rework emergency access for clinical projects
  A person outside a clinical project, administrators included, opens it only with a reason, for a set time, audited and notified to the owner. The grant names the project instead of a case ([ADR 0062](adr/0062-project-model.md)). De-identified projects need no emergency path (`emergency.py`, `folder_access.require_case_access`, migration `0018`).
  Done when API tests cover grant, expiry, refusal without a reason and an administrator reading a clinical project's patient only through it, and an ADR updates ADR 0047.
  Depends on ADAPT-001, PROJ-003. The privacy mode column exists since ADAPT-004, so it no longer waits for PROJ-002 ([ADR 0065](adr/0065-project-role-enforcement.md)).

- [x] ADAPT-011 · Patients only in clinical projects
  Keep the encrypted patient table and blind indexes (SEC-004) for clinical projects, refuse patient data in de-identified ones, and update the data classes (SEC-001). Each patient belongs to one clinical project, a key on the project's privacy mode refuses a patient in a de-identified project, and the MRN index is unique per project ([ADR 0062](adr/0062-project-model.md)).
  Done when API tests refuse a patient in a de-identified project, the data map is regenerated, and isolation tests pass.
  Depends on ADAPT-004. It needs only the privacy mode column, which ADAPT-004 created ([ADR 0063](adr/0063-cases-and-slides-in-projects.md)), so it no longer waits for PROJ-002 (privacy modes).

---

## Ideas for consideration

Kept from the hospital direction ([ADR 0053](adr/0053-ai-results-review-direction.md)). None of this is planned. The REPORT, BOARD, TEAM and TB epics below are ideas as a whole, and these tasks in other epics are ideas too: IAM-010 (guest consultant links), IAM-019 (sign-in by emailed code for outside consultants), SEC-023 (electronic signature record for sign-out), INGEST-023 (what the AI runs, per case), HOME-004 (variant B Department dashboard), HOME-005 (department metrics pipeline), HOME-006 (rebalance suggestion), WL-003 (AI status line), WL-004 (AI cell and dot semantics), WL-007 (case preview on demand), WL-009 (view D Day plan), WL-010 (reading-time estimate model), WL-011 (view E Slide grid), WL-012 (view switcher and persistence), WL-014 (AI queue panel), WL-015 (star and assign), CASE-008 (AI state: model not validated), CASE-012 (case state transitions), MEAS-004 (report linkage), COLLAB-008 (ask for a second opinion), COLLAB-009 (guest view), COLLAB-013 (consult record and structured opinion), COLLAB-014 (secure links for signed reports), CASES-005 (patient history), CASES-007 (FHIR import), CASES-008 (LIS adapter interface), CASES-010 (report output through the adapter), CASES-014 (field ownership between the LIS and the app), CASES-015 (patient matching and duplicates), CASES-018 (expected slides), CASES-019 (cancel, restore and merge cases), CASES-022 (assignment rules with a test run), CASES-025 (folder screens), CASES-023 (due time rules), AIP-005 (validation mapping per site and specimen), AIP-010 (pre-read on arrival), AIP-016 (AI plan per specimen type), AIP-017 (model approval and monitoring), SET-012 (home and worklist choice), NOTIF-003 (STAT banner), EXP-003 (home and worklist experiments).

---

## 19 REPORT · Clinical reports and sign-out

Idea for consideration since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Every task here starts with `Idea:` and keeps its ID. The evaluation report (EVAL) is the v1 output.

- [ ] REPORT-000 · Idea: Research check
  Check ICCR and CAP datasets for sentinel lymph node reporting and IHE PaLM APSR structure, and confirm the template engine and PDF choice (STACK-035). Start from [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md), re-read CAP Breast Invasive Resection 4.11.0.0 (the ADR read the element text from 4.9.0.0), and settle with the supervisor which template, report language and registry coding (ICD-O-3, SNOMED) a Czech laboratory uses. TODO.
  Done when an ADR names the dataset versions used.

- [ ] REPORT-001 · Idea: Report model and API
  Report per case with template id and version, field values with source (manual, measurement, AI confirmed), status draft, signed, amended, and signer.
  Done when API tests cover the lifecycle and audit entries.

- [ ] REPORT-002 · Idea: Template engine
  Templates as versioned data, with fields, types, conditional visibility, validation and computed fields. Lab admins can enable templates per specimen type.
  Done when unit tests evaluate conditions and computed fields.

- [ ] REPORT-003 · Idea: Sentinel lymph node template
  Elements from the ICCR dataset for surgically removed lymph nodes for breast tumours, with CAP's element names and answers and TNM 8 pN: clinical information, operative procedure, laterality, sentinel, non-sentinel and total nodes examined, nodes with metastatic carcinoma, with macrometastases and with micrometastases, isolated tumour cells only, tumour cells in a cluster at or under 0.2 mm, size of largest metastatic deposit, extranodal extension, treatment effect, ancillary studies, pN with (sn), (i+) or mi, and a local AI element. Each element is marked core, conditional or optional. A missing core or applicable conditional value renders as waiting with what it needs, never as a guess. When the breast is reported separately, a comment says "p" needs the primary tumour removed.
  Done when tests fill the template from seeded findings for a macrometastasis, a micrometastasis, isolated tumour cells only and a negative node, the category and pN are computed from the largest deposit and its count, and missing values render as waiting.
  Refs mock 14 and 15, kit Sign-out report, [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).

- [ ] REPORT-004 · Idea: Prefill from confirmed findings
  Fields fill only from what the doctor confirmed, never from raw AI output, and each AI-derived value names its source.
  Done when tests confirm unconfirmed AI areas never reach the report.

- [ ] REPORT-005 · Idea: Report tab and editor
  Field editing, sources shown, validation messages, a way to the full report (REPORT-014) and to sign-out.
  Done when component tests cover editing and validation.

- [ ] REPORT-006 · Idea: Before-signing checklist
  Category settled from the largest area, areas confirmed or marked as unable to change the category, unsure areas as a warning, tissue viewed percentage, open threads as a warning, and required report elements still empty, which block signing. Incomplete items link to the area, the element or to "go to unseen tissue".
  Done when unit tests compute the checklist from coverage and review data and E2E follows a "go to unseen" link.

- [ ] REPORT-007 · Idea: AI disclosure
  Exact model names and versions for every model whose output influenced a confirmed value, plus validation status. No CAP or ICCR wording exists yet, so the statement follows [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md): which model and version, what it did, what the pathologist reviewed, and that no value was set without review. It is marked as a local element and replaced when guidance appears.
  Done when tests check the disclosure against the job records.

- [ ] REPORT-008 · Idea: Sign-out
  Cmd+Enter or the sign-out action wherever it is offered, re-authentication per SEC-023, the case moves to signed, a transition back to the worklist. Sign-out is refused while a core report element is empty.
  Done when E2E signs out by keyboard, a test refuses sign-out with an empty core element, and the audit log and e-signature record exist.

- [ ] REPORT-009 · Idea: PDF rendering
  A4 pages in the usual order: laboratory and report status, patient and dates (the items 42 CFR 493.1291(c) lists), an amendment box when amended, specimen, clinical history, final diagnosis, the synoptic block with the standards it follows, comment, gross, microscopic, slides and stains, AI statement and the electronic signature. A running header from page 2, page n of N, and a DRAFT watermark until signed. Optional sections can be left out, and value sources never print. The PDF and the on-screen pages come from the same model and paginate the same.
  Done when a golden PDF test compares text content and layout fingerprints for a draft, a signed and an amended report, and a test confirms no value source reaches the PDF.
  Depends on STACK-035. Refs [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).

- [ ] REPORT-010 · Idea: Amendments and addenda
  After sign-out, changes create an amendment with reason, new signature and a visible history. The amended report says at its top what changed, why, when and by whom, and both versions are kept (42 CFR 493.1291(k)). An addendum adds information that does not change the diagnosis, such as a late stain, as its own signed section below the original. Both are sent again through the outbox (REPORT-022).
  Done when tests confirm the original stays immutable, the amendment chain renders, and an addendum leaves the diagnosis and its signature untouched.
  Refs kit Flow 19.

- [ ] REPORT-011 · Idea: "No tumor seen" variant
  For cases with no flagged area that went through a systematic scan.
  Done when tests require coverage above the lab threshold before this variant can be signed.

- [ ] REPORT-012 · Idea: Report attachments
  Review CSV, measurement list and selected snapshots attached to the report.
  Done when tests confirm attachments are generated and stored with the report.

- [ ] REPORT-013 · Idea: Report delivery hook
  Signed reports are published through the LIS adapter interface (CASES-010) and available as FHIR DiagnosticReport.
  Done when a contract test validates the FHIR resource.

- [ ] REPORT-014 · Idea: Full report view
  The doctor can read the whole report as pages before signing, see which required elements are filled and which are waiting, choose which optional sections to include and, in a draft, see where each value came from. From there they can sign, see the PDF, print and share it, and after signing start an amendment.
  Done when component tests cover a draft with waiting elements, a draft ready to sign, a signed and an amended report, pagination keeps a section title with its first line, axe passes, and E2E signs from this view.
  Depends on REPORT-001, REPORT-002, REPORT-009. Refs mock 15, kit W37, kit Sign-out report, [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).

- [ ] REPORT-015 · Idea: PDF preview, print and share
  The doctor sees the PDF exactly as it is stored, can print it and download it, and can share it according to its state. A draft only goes to a colleague for a read. A signed report goes to the requesting clinician automatically and can join a tumor board pack (HOME-009), go out as a secure expiring link that needs sign-in (IAM-010), or go to another laboratory. Release to a patient portal after the hospital's delay is shown but waits for a portal integration. Every share is audited.
  Done when E2E shares a signed report each way, a permission test refuses sharing a draft outside the department, audit entries exist, and printing produces the same A4 pages as the PDF.
  Depends on REPORT-009, IAM-010, HOME-009. Refs mock 15, kit W38, [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).

- [ ] REPORT-016 · Idea: Tumour cell content for molecular testing
  For cellularity cases the report gives the block and slide, the field assessed (outlined for macrodissection), the share of nucleated cells that are tumour cells with its likely range, whether it clears the assay minimum set by the lab, the cells counted, the unsure cells the pathologist checked, cells changed by learning and a macrodissection note, following the CAP Molecular Oncology Committee recommendations as confirmed in REPORT-000.
  Done when tests fill the section from seeded REVIEW-017 data, the verdict is computed against the lab's minimum including the "could be either side" case, and the values match the review panel.
  Depends on REVIEW-017, REPORT-002, SET-011. Refs mock 15 cell case, [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).

- [ ] REPORT-017 · Idea: HL7 v2 and IHE APSR output
  Signed and amended reports also leave as HL7 v2.5 with the synoptic values as coded observations (the NAACCR Volume V style CAP checklists use) and as an IHE APSR document on HL7 CDA R2 with its diagnostic conclusion section, through the adapter interface (CASES-008).
  Done when contract tests validate the CDA against the APSR templates and the HL7 message with a parser, for a signed and an amended report.
  Depends on REPORT-013, CASES-008. Refs [ADR 0022](adr/0022-sign-out-report-standards-and-pdf-preview.md).


- [ ] REPORT-018 · Idea: Undo window before delivery
  Signing locks the report version and starts a grace period, set by the lab (default 10 s), before the report goes to the outbox. Unsigning inside it returns the report to draft and is audited. After it only an amendment changes the report.
  Done when API tests with a fake clock cover unsigning inside and outside the window, and a test proves nothing reaches the outbox before the window ends.
  Depends on REPORT-008, REPORT-022. Refs kit W61, kit Flow 16, [ADR 0023](adr/0023-gap-review-backend-first.md).

- [ ] REPORT-019 · Idea: Resident draft and supervisor co-sign
  A resident sends a draft for review, and the case moves to with the supervisor (CASES-012). The supervisor's edits are kept as changes against the resident's version. The supervisor returns the case with a note or co-signs, which records both people (reported by, verified by) with two electronic signature records.
  Done when API tests cover send, return with a note, co-sign, the change list between versions and both signature records, and a resident's direct sign-out is refused.
  Depends on IAM-018, SEC-023, CASES-012. Refs kit W55, kit Flow 14, [ADR 0023](adr/0023-gap-review-backend-first.md).

- [ ] REPORT-020 · Idea: Free-text templates and phrases
  Templates for specimens without a synoptic protocol: sections and required items, enabled per specimen type. A phrase library per lab and per person expands short codes into text. Measurements insert with their source, as in synoptic reports. The sign-out gate refuses a report with an empty required item.
  Done when unit tests cover expansion, required items and measurement sources, and API tests cover the phrase libraries' permissions.
  Depends on REPORT-002. Refs kit W72.

- [ ] REPORT-021 · Idea: Report editing lease
  Only the assignee, or the supervisor during review, edits the calls and the report draft. Editing takes a lease that expires after 10 idle minutes. Anyone else reads, measures and comments. A take-over request reaches the lease holder, who can accept or refuse, and an expired lease can be taken.
  Done when API tests with two users cover the lease, a refused write, a take-over and expiry with a fake clock.
  Depends on REPORT-001, COLLAB-007. Refs kit W66, [ADR 0023](adr/0023-gap-review-backend-first.md).

- [ ] REPORT-022 · Idea: Delivery outbox
  Signed reports, amendments, addenda and their messages leave through an outbox with states waiting, sent, delivered and rejected. Delivery retries with backoff and keeps the order per case. Sign-out succeeds while the LIS is down, and the queue drains when it is back. A rejected message keeps the receiver's error and can be retried after a fix, or answered with an amendment.
  Done when tests cover retry, ordering, a receiver that is down for an hour, a rejection and a retry after the fix, with the file-drop adapter.
  Depends on REPORT-013, CASES-008. Refs kit W67, kit W70, kit Flow 30.

- [ ] REPORT-023 · Idea: Code mappings for outgoing reports
  Each tenant keeps a versioned mapping from report values to the codes its receivers need (HL7 tables, SNOMED CT, ICD-O-3). A value without a mapping stops that message with an error that names the value. Administrators edit the mappings and every change is audited.
  Done when tests cover a mapped value, an unmapped value that stops the message and names it, and a mapping change that lets a retry through.
  Depends on REPORT-017, REPORT-022.

---


## 37 BOARD · Status board, tickets and lab work

Idea for consideration since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Every task here starts with `Idea:` and keeps its ID.

A page of its own next to the worklist ([ADR 0021](adr/0021-chosen-home-worklist-status-board-and-account-menu.md)). Cases are tickets, and the lab work hanging off them (recuts, IHC stains, rescans, second opinions) are sub-tasks with their own owner, so hand-offs between pathologists and with the lab are visible. Layout follows the current prototype (mock 3, kit Status board page, kit W16 and W34).

- [ ] BOARD-000 · Idea: Research check
  Board and drag-and-drop libraries, ticket workflow models, and how LIS systems expose lab orders such as recuts, stains and rescans.
  Done when an ADR records the ticket and sub-task model and the library choice.

- [ ] BOARD-001 · Idea: Ticket and lab task model and API
  A case ticket carries the case's workflow status, priority, due time, service, assignee, watchers and links (earlier cases, tumor boards). Lab tasks hang off a case with a type (recut, IHC stain, rescan, second opinion), block, notes, owner or team, status (requested, in progress, ready to scan, done) and due time. Every change is an event in the ticket's history.
  Done when API tests cover the lifecycle of tickets and lab tasks, tenant isolation and audit entries.
  Depends on CASES-001, BOARD-000.

- [ ] BOARD-002 · Idea: Case workflow status
  Status is derived where it can be (waiting for AI from the jobs, waiting on others from open lab tasks or second opinions, report drafted from the report) and moved by people where it cannot, within allowed transitions. Signed is reached only by signing out the case (REPORT-008).
  Done when unit tests cover each derivation and every allowed and refused transition.
  Depends on BOARD-001, REPORT-001, AIP-010, CASES-012.

- [ ] BOARD-003 · Idea: Board page
  Case tickets by workflow status, with today's signed cases as a count, reached from the sidebar next to the worklist. Each card identifies the case and patient and shows priority, specimen, service, lab work done of total, comments, due time (due today stands out) and assignee. A work-in-progress limit set by the lab warns when a status is over it.
  Done when component tests cover cards, the limit warning and empty statuses with seeded data, the board stays smooth with 500 tickets, and axe passes.
  Depends on BOARD-002, WL-002.

- [ ] BOARD-004 · Idea: Scopes, filters and search
  Scopes for the whole department, only my tickets and the histology lab. Quick filters for STAT, due today, unassigned and waiting on the lab, a filter by person and a search. The state is kept in the URL.
  Done when component tests cover combined filters and E2E restores a filtered board from its URL.

- [ ] BOARD-005 · Idea: Group by person
  The board can group tickets into one lane per assignee, with unassigned tickets in their own lane last.
  Done when component tests cover grouping with unassigned and empty lanes.

- [ ] BOARD-006 · Idea: Ticket details
  Opening a ticket shows, without leaving the board, its status with the allowed moves, a way to open the case and to request lab work, the AI summary, clinical note, lab work with owners and status, linked items, the activity with comments (mentions through COLLAB-006) and history, and the fields: assignee, requesting clinician, priority, due with time left, time in the current status, service, watchers, created and updated. Closing it keeps the board's scroll, filters and selection.
  Done when component tests cover each part, E2E changes a status from the ticket, and keyboard users can open, read and close a ticket.
  Depends on BOARD-002, COLLAB-002.

- [ ] BOARD-007 · Idea: Reassigning
  Anyone can hand off their own ticket or take an unassigned one, and lab leads can move anyone's. The picker shows each person's open cases, specialty and availability (IAM-015). People who are away are not selectable and their back-up is named. It suggests the consultant with the fewest open cases and a matching specialty and never suggests a resident alone. A reason is optional and goes into the history. Both people are notified, a ticket can go back to the unassigned pool, "assign to me" is one action, and a reassignment can be undone right after.
  Done when unit tests cover the suggestion, permission tests cover who may move what, and E2E reassigns with audit, history and notifications.
  Depends on BOARD-001, IAM-015, NOTIF-001.

- [ ] BOARD-008 · Idea: Request lab work
  From a ticket or a case, request a recut, an IHC stain, a rescan or a second opinion, with the block, notes and who does it. A second opinion goes through COLLAB-008.
  Done when E2E requests a recut that appears on the histology lab's board and on the case.
  Depends on BOARD-001, COLLAB-008.

- [ ] BOARD-009 · Idea: Histology lab view
  Lab tasks by requested, in progress, ready to scan and done today, for technicians to update. Each task links to its case ticket, and pathologists see the change on the ticket and in the worklist preview.
  Done when E2E has a technician move a task and the pathologist sees the new status.
  Depends on BOARD-004, BOARD-008.

- [ ] BOARD-010 · Idea: Moving tickets
  Tickets move between statuses by drag and drop or by keyboard. Only allowed moves are accepted, and a move to signed is refused with a pointer to sign-out. Every move is audited.
  Done when E2E moves a ticket by pointer and by keyboard, and a refused move leaves the ticket where it was.
  Depends on BOARD-002, BOARD-003.

- [ ] BOARD-011 · Idea: Realtime board
  Changes by others appear without a reload.
  Done when E2E with two sessions shows a move, a reassignment and a new lab task within 2 s.
  Depends on COLLAB-001.

- [ ] BOARD-012 · Idea: Lab orders from the LIS
  Stains and recuts that the LIS already tracks are read through the adapter rather than kept as a second copy.
  Done when a contract test maps a lab order from the file-drop adapter to a lab task and back.
  Depends on CASES-008.


- [ ] BOARD-013 · Idea: Lab work from the case, with a spot
  A lab request made while reading carries the spot on the slide (slide, position and zoom) for the lab, and a choice to keep the case in review or put it on hold, which moves it to waiting on others. When the stained or rescanned slide arrives it is linked to the request and marked new in the case.
  Done when API tests cover the spot, both choices, and the new slide linked to its request.
  Depends on BOARD-008, CASES-012. Refs kit W54, kit Flow 13.

---

## 38 TEAM · Team, capacity, absences and hand-over

Idea for consideration since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Every task here starts with `Idea:` and keeps its ID.

How a lead controls who works on what: absences and back-ups, each person's capacity, moving many cases at once and handing work over. Backend first ([ADR 0023](adr/0023-gap-review-backend-first.md)). The Team page with its People, Capacity and Rota views (kit W45 to W48) gets its UI tasks when the prototype settles.

- [ ] TEAM-000 · Idea: Research check
  How hospitals keep rotas (iCalendar feeds, HR exports, CSV) and how scheduling products model capacity and absence.
  Done when an ADR records the absence and capacity model and the rota import format.

- [ ] TEAM-001 · Idea: Absence model and API
  An absence has a person, dates, a kind (leave, sickness, course, tumor board, on call), a back-up and a source (entered here or imported). On its days the person's availability turns away by itself (IAM-015), except for kinds that only reduce capacity, such as a tumor board or on call. Absences are entered by the person or a lead.
  Done when API tests cover each kind, the availability it produces on its days with a fake clock, and who may enter absences for whom.
  Depends on IAM-015, TEAM-000. Refs kit W47, kit Flow 22.

- [ ] TEAM-002 · Idea: Rota import
  The hospital's rota is read on a schedule from the format TEAM-000 chooses. Imports are idempotent, entries keep their source, and entries made here are never overwritten.
  Done when tests import the same rota twice without duplicates, update a changed entry and keep a manual one.
  Depends on TEAM-001.

- [ ] TEAM-003 · Idea: Capacity and booked reading time
  Each person has a capacity per working day, reduced by absences and blocks. Booked reading time per day is the sum of the reading-time estimates (WL-010) of their open cases by due day. The API returns capacity, booked time and overflow per person and day.
  Done when unit tests cover capacity with absences and blocks, and an API test returns the overflow for a seeded week.
  Depends on TEAM-001, WL-010. Refs kit W46.

- [ ] TEAM-004 · Idea: Absence hand-over
  Creating an absence lists the person's cases due while they are away. Each can stay, go to the back-up or go back to the pool, and the choice is applied on the first day of the absence. Everyone involved is notified.
  Done when API tests with a fake clock apply each choice on the start day and send the notifications.
  Depends on TEAM-001, BOARD-007, NOTIF-001.

- [ ] TEAM-005 · Idea: Bulk reassign
  Move many cases in one request. Each case gets a suggested person by room and folders, the lead can override any of them, and an optional reason applies to all. The move is all or nothing, it is audited per case, and notifications are batched per person.
  Done when API tests cover a full move, a refused move that leaves every case where it was, the per-case audit entries and one notification per person.
  Depends on BOARD-007, TEAM-003. Refs kit W46, kit Flow 23.

- [ ] TEAM-006 · Idea: Team directory API
  People with role, folders, availability, open cases against capacity, back-up and last activity. Leads and administrators see everything, other staff see names, roles, folders and availability only, and outside consultants see nothing.
  Done when API tests cover each role's view and tenant isolation.
  Depends on IAM-016, TEAM-003. Refs kit W45.

---

## 39 TB · Tumor boards

Idea for consideration since [ADR 0053](adr/0053-ai-results-review-direction.md). Not planned. Every task here starts with `Idea:` and keeps its ID.

Preparing a multidisciplinary tumor board, presenting at it and bringing its outcome back into the case. Backend first ([ADR 0023](adr/0023-gap-review-backend-first.md)). The session and present-mode screens (kit W58, W59) get their UI tasks when the prototype settles.

- [ ] TB-000 · Idea: Research check
  How tumor board software prepares sessions, what the board records, and how outcomes reach the clinician.
  Done when an ADR records the session model.

- [ ] TB-001 · Idea: Session model and API
  A session has a board (for example breast), a date and time, a place and a video link, members, and an ordered list of cases, each with the clinician's question, a presenter and whether it is prepared. A case is added from the case or from the session.
  Done when API tests cover sessions, ordering, adding and removing cases, permissions and tenant isolation.
  Depends on TB-000, CASES-001. Refs kit W58, kit Flow 17.

- [ ] TB-002 · Idea: Pinned views and talking points
  Each case in a session holds pinned views (slide, camera and layers) and talking points for the presenter only.
  Done when API tests cover pinning, reordering and that talking points are visible only to the presenter.
  Depends on TB-001.

- [ ] TB-003 · Idea: Outcome
  The board's outcome is written per case during the session, saved to the case history, audited and optionally sent to the requesting clinician.
  Done when API tests cover recording, the case history entry, the audit entry and sending.
  Depends on TB-001, NOTIF-001. Refs kit W59.

- [ ] TB-004 · Idea: Handout pack
  A PDF for the session with each case's report and pinned views, with patients shown by initials when the session asks for it.
  Done when a golden PDF test checks a pack in both identity modes.
  Depends on TB-002, REPORT-009.

---

## Later epics (not in v1, kept for planning)

- DICOMweb reader and DICOM WSI ingest (doc 20 §3.4).
- MRXS, iSyntax (libisyntax to WASM), CZI and VSI readers.
- SFTP or SMB scanner shares and watching a link for new slides as import sources. Watched buckets are REMOTE-004.
- LIS integration over HL7 v2 and FHIR with a real LIS, now an idea with the rest of the hospital direction.
- Offline cases with a service worker cache.
- CRDT multiplayer annotation.
- IVDR, FDA and EU AI Act regulatory evidence packages.
- Full localisation (Czech first).
- Foundation-model features beyond tumor maps (tissue classification, search by similar region).
