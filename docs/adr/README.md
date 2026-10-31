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
| [0023](0023-gap-review-backend-first.md) | Gap review: one case state model, cases from the LIS first, roles narrowed by folders, team control, and backend before UI | Superseded by 0053 | 2026-10-10 |
| [0024](0024-workspaces-are-tenants.md) | Each workspace is a tenant, organisations group them, and platform operators manage both | Accepted | 2026-10-13 |
| [0025](0025-zitadel-bff-login.md) | Zitadel Cloud behind a FastAPI backend-for-frontend with sessions in Postgres | Accepted | 2026-10-13 |
| [0026](0026-roles-and-permission-matrix.md) | Six roles and the UX kit's permission matrix in code, declared on every route | Superseded by 0061 | 2026-10-13 |
| [0027](0027-audit-log-hash-chain-in-postgres.md) | Audit log as an append-only Postgres table with a hash chain per workspace and people named by erasable pseudonyms | Accepted | 2026-10-14 |
| [0028](0028-data-classes-on-columns.md) | Five data classes declared on every column, with a generated data map | Accepted | 2026-10-14 |
| [0029](0029-service-accounts-with-own-api-tokens.md) | Service accounts per workspace with our own hashed API tokens and narrow scopes | Accepted | 2026-10-14 |
| [0030](0030-invitations-bound-to-verified-email.md) | Invitations bound to a verified email, accepted by a signed-in person, with operators inviting first administrators | Accepted | 2026-10-14 |
| [0031](0031-idle-lock-from-explicit-activity.md) | Idle lock driven by explicit activity, unlocked by signing in again, with limits set per workspace | Accepted | 2026-10-14 |
| [0032](0032-signing-rights-on-the-membership.md) | Signing rights on the membership, decided by one function, changed only by a lead | Superseded by 0056 | 2026-10-14 |
| [0033](0033-envelope-encryption-with-tenant-data-keys.md) | Envelope encryption with versioned tenant data keys under a rotating master keyring | Accepted | 2026-10-14 |
| [0034](0034-blind-indexes-for-encrypted-patient-identifiers.md) | Exact-match blind indexes for encrypted patient identifiers, with name search by whole words | Accepted | 2026-10-14 |
| [0035](0035-fhir-r4-through-fhir-resources-r4b.md) | FHIR R4 on the wire through fhir.resources' R4B models, with codes checked by us and no FHIR server | Accepted | 2026-10-14 |
| [0036](0036-case-data-model.md) | Case data model: patient, case, specimen, block and slide, with the kit's ten states and FHIR's codes | Superseded by 0063 | 2026-10-14 |
| [0037](0037-accession-number-templates.md) | Accession numbers from a per-workspace template with a counter per prefix and year | Superseded by 0058 | 2026-10-14 |
| [0038](0038-case-state-machine.md) | Case state machine: named events with allowed actors, derived moves by the system, cancel and restore by leads | Superseded by 0057 | 2026-10-14 |
| [0039](0039-email-through-resend-with-phi-rules.md) | Send email through Resend, with bounce handling and a rule that email never carries PHI | Accepted | 2026-10-14 |
| [0040](0040-observability-and-phi-scrubbing.md) | Observability with OpenTelemetry, Grafana Cloud and Sentry, and one PHI scrubbing rule set | Accepted | 2026-10-14 |
| [0041](0041-identity-and-authorization-rechecked.md) | Identity and authorization rechecked in October 2026: Zitadel Cloud and row-level security with roles in code both confirmed | Accepted | 2026-10-14 |
| [0046](0046-roles-narrowed-by-folders.md) | Folder-scoped permissions apply inside a person's folders, unfiled cases stay open, and leads may work in every folder | Superseded by 0059 | 2026-10-14 |
| [0042](0042-model-licensing-policy.md) | Model licensing policy: Parfocal is commercial, and the registry blocks any model whose weights or training data licences are not confirmed | Rejected | 2026-10-14 |
| [0045](0045-forms-and-validation.md) | Forms with TanStack Form and Zod 4, and report forms driven by template data | Accepted | 2026-10-14 |
| [0044](0044-background-jobs-and-workflows.md) | Background jobs and workflows on Postgres tables with leases, confirming the default of ADR 0003 | Accepted | 2026-10-14 |
| [0047](0047-emergency-access-with-a-reason.md) | Emergency access: a written reason opens one case for a lab-set time, administrators included | Superseded by 0066 | 2026-10-14 |
| [0051](0051-availability-status-and-back-up.md) | Availability status per workspace, with an away person's new cases going to their back-up | Superseded by 0055 | 2026-10-15 |
| [0052](0052-task-board-from-backlog-and-claim-files.md) | A task board read from the backlog, with one claim file per task | Accepted | 2026-10-15 |
| [0043](0043-server-slide-reading.md) | Server slide reading with OpenSlide first, tiffslide for OME-TIFF and tifffile for validation | Accepted | 2026-10-15 |
| [0048](0048-routing.md) | Routing with TanStack Router and Zod search params | Accepted | 2026-10-15 |
| [0049](0049-server-state-and-data-fetching.md) | Server state in TanStack Query v5 on the generated client, with event-driven invalidation | Accepted | 2026-10-15 |
| [0050](0050-deploy-pipeline-and-previews.md) | Deploy pipeline and per-pull-request previews on Cloudflare, Modal and Neon | Accepted | 2026-10-15 |
| [0053](0053-ai-results-review-direction.md) | Parfocal becomes an AI results review app, the hospital sign-out workflow is kept as ideas, and the built hospital code is reverted or reworked | Accepted | 2026-10-17 |
| [0054](0054-hospital-code-inventory-and-revert-order.md) | The built hospital code is reverted first, then the roles change, then cases move into projects, with migrations edited in place | Accepted | 2026-10-17 |
| [0055](0055-away-until-with-a-note.md) | Availability is available or away, with an optional end and note, and no back-up | Accepted | 2026-10-17 |
| [0056](0056-no-signing-rights.md) | Signing rights, supervision and stored signatures are removed | Accepted | 2026-10-17 |
| [0057](0057-no-case-state-machine.md) | Cases have no state machine, and the slide pipeline per task takes its place | Accepted | 2026-10-17 |
| [0058](0058-typed-case-ids.md) | Case IDs are typed or come from file names, and accession templates and counters are removed | Accepted | 2026-10-17 |
| [0059](0059-no-folders.md) | Folders are removed, and access is by role across the workspace until project roles land | Accepted | 2026-10-17 |
| [0060](0060-no-sign-out-permissions-or-guest-scope.md) | The sign-out permissions, the outside consultant and the guest scope are removed | Accepted | 2026-10-17 |
| [0061](0061-researcher-reviewer-and-admin-roles.md) | Workspace roles are researcher, reviewer and admin, with owner, reviewer and viewer per project | Superseded by 0096 | 2026-10-17 |
| [0062](0062-project-model.md) | Projects hold optional cases, slides and result sets, need a membership to open, and own their patients | Accepted | 2026-10-17 |
| [0063](0063-cases-and-slides-in-projects.md) | Cases and slides live in projects, a case is optional, and the hospital case columns are gone | Accepted | 2026-10-17 |
| [0064](0064-project-api.md) | The project API: numbered per workspace, membership to read, owners to change, archive instead of delete | Accepted | 2026-10-17 |
| [0065](0065-project-role-enforcement.md) | Project roles narrow the workspace grant, only workspace members reach workspace routes, and owners stay researchers | Accepted | 2026-10-17 |
| [0066](0066-emergency-access-per-clinical-project.md) | Emergency access opens one clinical project for a set time, for researchers and admins outside it | Accepted | 2026-10-17 |
| [0067](0067-class-taxonomy-and-colour-check.md) | Each project has up to nine classes on keys 1 to 9, checked by CIEDE2000 under three colour-vision deficiencies, with remembered import mappings | Accepted | 2026-10-17 |
| [0068](0068-structured-logging-on-the-standard-library.md) | JSON logs from the standard library, with request context in a context variable and one access line per request | Accepted | 2026-10-18 |
| [0069](0069-slide-pipeline.md) | The slide pipeline is derived from stored facts, and people move only submit, reopen and sign-off | Accepted | 2026-10-18 |
| [0070](0070-result-file-parsers.md) | Result files are read with msgspec, shapely, the csv module, tifffile and OpenCV into one object form, with Parfocal JSON v1 as the native format | Accepted | 2026-10-18 |
| [0071](0071-object-id-grammar.md) | Object IDs are a kind letter and a per-slide number, paths are percent-encoded with `~` for loose slides, and IDs carry across result sets by IoU 0.5 or 4 µm | Accepted | 2026-10-18 |
| [0072](0072-verdicts-reasons-and-opinion-forms.md) | A verdict is one current answer per reviewer, task and object with a coded reason, and the opinion form is a versioned list of four question kinds | Accepted | 2026-10-18 |
| [0073](0073-audit-queries-and-signed-export.md) | Audit queries for admins, and exports signed with an Ed25519 key derived per workspace from the master key | Accepted | 2026-10-18 |
| [0074](0074-notifications-as-rows-with-an-email-outbox.md) | Notifications are rows routed by per-kind preferences, with email sent from an outbox after commit and STACK-036 confirmed | Accepted | 2026-10-18 |
| [0075](0075-slide-thumbnails-and-overviews.md) | Thumbnails (256 px) and overviews (1024 px) are JPEG renders of the slide pyramid through the reader of record, with goldens for colour | Accepted | 2026-10-18 |
| [0076](0076-annotation-and-ai-result-storage.md) | AI cells are binary chunks with a summary in object storage, AI regions and human annotations are PostGIS rows with a version table | Accepted | 2026-10-18 |
| [0077](0077-result-sets.md) | A result set is created importing, filled by the worker and then immutable in the database, soft-deleted, and the reviewed-delete confirmation moves to RSET-009 | Accepted | 2026-10-18 |
| [0078](0078-review-task-model.md) | A review task pins one finished result set per slide, stores assignments from its split, and opens task slides to their reviewers | Accepted | 2026-10-18 |
| [0079](0079-reviewed-layer.md) | The reviewed layer is one edit row per task, reviewer and AI object, plus task annotations for added objects | Accepted | 2026-10-18 |
| [0080](0080-disagreement-rule-and-sign-off.md) | Disagreements are reviewers who differ or a majority against the AI, and sign-off needs every slide submitted and an empty queue | Accepted | 2026-10-18 |
| [0081](0081-uploads-are-checked-by-structure.md) | Uploads are checked by structure (format, byte ranges, zip CRCs) without an antivirus scanner | Accepted | 2026-10-18 |
| [0082](0082-my-work-query-api.md) | My work is three read endpoints, one per tab, with keyset pages for All slides and the storage filter moved to REMOTE-001 | Accepted | 2026-10-18 |
| [0083](0083-typst-for-report-pdfs.md) | Report PDFs are rendered with Typst from the evaluation data, deterministic with the sign-off time as timestamp | Accepted | 2026-10-18 |
| [0084](0084-evaluation-metrics.md) | Evaluation metrics count AI objects against the reviewers' consensus, with kappa between reviewers, and the decisions API moves to ADJ-006 | Accepted | 2026-10-18 |
| [0085](0085-home-aggregate-api.md) | Home is one aggregate read, `GET /api/me/home`, with resume derived from review activity and the announcements API split into HOME-011 | Accepted | 2026-10-18 |
| [0086](0086-node-staging-rules.md) | Node staging is a pure function, the largest area by its best size leads, and a node settles only when no other area can outrank it | Accepted | 2026-10-18 |
| [0087](0087-origin-check-on-cookie-writes.md) | Cookie-authenticated writes must come from the app origin, checked by `Origin` or `Sec-Fetch-Site` | Accepted | 2026-10-18 |
| [0088](0088-rate-limits-in-postgres-and-at-the-edge.md) | Rate limits per person and per workspace are counted in Postgres by the API, and per-IP limits sit at the edge | Accepted | 2026-10-18 |
| [0089](0089-retention-purge-and-audit-re-anchor.md) | Retention purges expired soft-deleted records through one database function, and old audit entries are purged with a re-anchor | Accepted | 2026-10-18 |
| [0090](0090-access-export-and-erasure.md) | People export their own data, project owners export and erase patients, and an erased person keeps their work under "Former member" | Accepted | 2026-10-18 |
| [0091](0091-notification-catalogue-and-targets.md) | Notifications follow one catalogue of kinds with a target and a template each, and links open the notification, which resolves its target (replaces the link form of 0074) | Accepted | 2026-10-18 |
| [0092](0092-email-digest-and-quiet-hours.md) | Each person chooses immediate, hourly or daily email and quiet hours in their own time zone, and mandatory kinds are never held | Accepted | 2026-10-18 |
| [0093](0093-evaluation-metrics-and-datasets.md) | Model evaluation uses PQ, AJI, mIoU, NoC, ECE and FROC on held-out sets kept outside the repository, each used within its licence | Accepted | 2026-10-18 |
| [0094](0094-search-on-postgres.md) | Search runs in Postgres under row-level security, with labels matched by ILIKE and patients by whole-word blind tokens | Accepted | 2026-10-18 |
| [0095](0095-ux-round-5-upload-by-slide-and-verdict-notes.md) | Upload has three steps with results under their slides, verdict reasons become optional and several, the magnification bar folds to a chip and slides load coarse first, plus passkey sign-in and the storage bar | Accepted | 2026-10-19 |
| [0096](0096-researcher-and-reviewer-with-admin-rights.md) | Workspace roles are researcher and reviewer, admin is a right a researcher holds, and each role's responsibilities are written down | Accepted | 2026-10-20 |
| [0097](0097-report-templates-built-from-blocks.md) | The evaluation report is built from blocks, and study templates preset a review task and its report | Accepted | 2026-10-20 |
| [0098](0098-viv-and-deck-gl-versions.md) | Viv 0.23 on deck.gl 9.4 and luma.gl 9.4.2 over WebGL2, with deck.gl's WebGPU backend as the alternate route and a dispose wrapper for the canvas leak | Accepted | 2026-10-23 |
| [0099](0099-tiff-and-zarr-readers-in-the-browser.md) | The browser reads TIFF with geotiff.js and OME-Zarr with zarrita, behind one PixelSource interface with a tested workaround for each known reader bug | Accepted | 2026-10-23 |
| [0100](0100-viewer-hot-path-state-outside-react.md) | Viewer hot-path state lives in the engine and React reads it through useSyncExternalStore with a selector | Accepted | 2026-10-23 |
| [0101](0101-golden-image-comparison.md) | Golden images are rendered on SwiftShader everywhere and compared per channel with per-codec tolerances, after an empty-frame check | Accepted | 2026-10-23 |
| [0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md) | The Viv route hands MultiscaleImageLayer a virtual power-of-two ladder of interleaved RGB tiles built from our PixelSource, with the YCbCr conversion done once in the reader | Accepted | 2026-10-23 |
| [0103](0103-memory-settings-and-test-baseline.md) | Deck memory settings live in one shared module, uint8 channels upload as r8unorm through a patched upload, and the memory test takes its baseline after one warm-up cycle | Accepted | 2026-10-23 |
| [0104](0104-camera-controller-motion.md) | The camera controller runs inside the engine's frame with an injected clock, clamps every target before deriving a path, and flies the van Wijk and Nuij zoom and pan path in 400 to 700 ms by path length | Accepted | 2026-10-23 |
| [0105](0105-decode-workers-behind-one-byte-cache.md) | Six decode workers read the slide through one byte cache on the page and never drop work that has started | Accepted | 2026-10-23 |
| [0106](0106-camera-bounds-and-feel-profiles.md) | Camera bounds come from one function that follows the slide, and one live camera profile holds every tunable, with Smooth, Precise and Instant presets and reduced motion switching off the profile's motion | Accepted | 2026-10-23 |
| [0107](0107-viewer-input-binding.md) | Viewer input goes through a pure gesture interpreter, ends drags from the window and guesses the wheel device from its deltas | Accepted | 2026-10-23 |
| [0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) | Overlay layers are typed data with one z-order table, drawn through deck.gl with precomputed polygon indices | Accepted | 2026-10-25 |
| [0109](0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md) | An idle viewer asks for no animation frames, and a hidden tab keeps loading on finished-read frames instead of drawing on a timer | Accepted | 2026-10-25 |
| [0110](0110-native-jpeg-decode-and-tissue-fit.md) | JPEG tiles decode natively only where a per-file probe agrees with the script decoder, and a slide opens fitted to its tissue box with a 5 percent margin | Accepted | 2026-10-25 |
| [0113](0113-interaction-signal-units-and-touch-gestures.md) | A shared interaction signal pauses background work during camera motion, one units module derives the scan objective and digital label, and the gesture interpreter reads touch taps | Accepted | 2026-10-26 |
| [0111](0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) | JPEG 2000 decodes in the decode workers through OpenJPEG WebAssembly with a grey damaged-tile placeholder, and OME-TIFF channel pages become channels | Accepted | 2026-10-26 |
| [0112](0112-finest-level-sampling-and-webgl-context-recovery.md) | The finest level magnifies with nearest sampling through a guarded Viv patch, and a lost WebGL context is rebuilt from the route's own state | Accepted | 2026-10-26 |
| [0114](0114-thesis-assignment-tasks.md) | The thesis assignment adds the least sure first order (GUIDE-012) and application performance on main paths (TEST-019), and every piece of thesis material lives in a private repository | Accepted | 2026-10-31 |
| [0115](0115-production-access-and-spend-caps.md) | Agents may touch real infrastructure, read-only by default, with every production write approved by the owner and every billing service capped or alerted | Accepted | 2026-10-31 |
| [0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) | Slides upload as S3 multipart straight to R2 through Uppy in Companion mode, with the API creating, signing one 16 MiB part at a time, listing, checking equal part sizes and completing | Accepted | 2026-10-31 |
| [0117](0117-review-order-is-stored-per-task-slide.md) | The least sure first order is stored per task slide when the task is made, not computed on read, so a recalibration cannot reshuffle a running review | Proposed | 2026-10-31 |
| [0119](0119-inbox-mutes-for-projects-tasks-and-cases.md) | A person mutes a project, a review task or a case, a muted event is neither stored nor emailed, and mentions and emergency access still get through | Proposed | 2026-10-31 |
