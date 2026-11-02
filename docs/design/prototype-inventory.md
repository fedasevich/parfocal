# Prototype inventory

Every screen and scene of the frozen hi-fi mock and every page of the frozen UX kit in [docs/design/](README.md), with the PROTO task that builds it over fake data, the DS, SHELL or feature task that later owns it, and the API it reads. PROTO-001 (freeze the redesigned prototype) wrote it on 2026-11-01 from mock version `1793543251-80da` and kit version `1793543567-f4c8`. The owner reviews it together with each screen group as the PROTO screen tasks land.

## How it was counted

The mock declares each screen with `screen(id, title, render, caption, opts)` into one `screens` array, and a screen with scenes carries `opts.scenes.list`, a list of scene keys and names. The lists below were read from that array in a headless browser, so they match what the mock's scene chips show. The mock has 40 screens and 248 scenes, 37 of them issue scenes. The POC's scene walker reports 265, because it also counts the 17 times it opens one of the 16 small modals. The settings and shortcuts screens share one list of 16 scene keys, so Shortcuts opens the same dialog at its Shortcuts section.

The kit declares its pages in `PF_PAGES` (21 Parfocal pages) and `SA_PAGES` (4 specs and analysis pages).

Refs in the backlog name a scene as `mock: <screen id>/<scene key>`, such as `mock: guided/done`.

## Mock screens

The API column names operations of [openapi.json](../../packages/api-client/openapi.json) by `operationId`. A feature task that needs an operation the API does not have yet is named instead. The decision operations are still called `saveVerdict`, `clearVerdict` and `listVerdicts`, and GUIDE-014 (use "decision" in code identifiers) renames them.

| Screen | Title | Scenes | Built by | Owned later by | API |
|---|---|---|---|---|---|
| `flowmap` | How a review works | One state, no scenes | PROTO-012 (How a review works, the flow map) | None. It is the start page of the dev build and is not shipped | None needed |
| `home` | Home | `launch`, `new` | PROTO-003 (Home, My work and the shell) | HOME-002 (launchpad home), ONB-006 (getting-started checklist), SHELL-002 (global top bar and sidebar), SHELL-012 (account menu) | `getMyHome`, `getMe`, `listAnnouncements` |
| `worklist` | My work | `review`, `preview`, `anna`, `assigned`, `all`, `allpreview` | PROTO-003 (Home, My work and the shell) | WL-005 (To review tab), WL-018 (Assigned by me tab), WL-019 (All slides tab), ADJ-008 (send to an adjudicator) for the adjudication entry | `listMyReviewTasks`, `listTasksAssignedByMe`, `listMySlides`, `getReviewTask`, `getReviewTaskStates` |
| `project` | Project | `slides`, `results`, `tasks`, `settings`, `importfail` | PROTO-004 (Project page, new project and upload) | PROJ-006 (project page), PROJ-008 (project settings), PROJ-009 (Can sign out), RSET-005 (import checks and fixes) for the import failure | `getProject`, `updateProject`, `listCases`, `listProjectResultSets`, `listReviewTasks`, `setProjectMember`, `removeProjectMember`, `listProjectClasses`, `setProjectClasses` |
| `newcase` | New project or case | `project`, `case`, `casec` | PROTO-004 (Project page, new project and upload) | PROJ-007 (new project and new case), CASES-002 (case creation UI) | `createProject`, `createCase`, `listTaxonomyTemplates` |
| `upload` | Upload slides and results | `drop`, `empty`, `files`, `link`, `remote`, `check`, `allgood`, `progress`, `done`, `tray`, `viewer`, `api`, `dup`, `storagefull`, `unmatched`, `sourceoff` | PROTO-004 (Project page, new project and upload) | INGEST-021 (upload wizard with slides and results), INGEST-022 (per-file problems in the Check step), INGEST-024 (upload progress with steps per slide), INGEST-025 (import slides from a link), RSET-006 (add a result set from the viewer), REMOTE-001 (read in place from a connected source), REMOTE-002 (webhook in per project) | `createUpload`, `signUploadPart`, `listUploadParts`, `completeUpload`, `abortUpload`, `findOpenUpload`, `getUploadStatus`, `pairResultFiles`, `pairUploadWithSlide`, `createResultSet`, `validateResultsFile`. Link, remote and webhook imports have no API yet |
| `runmodel` | Run a model | `pick`, `menu`, `lab`, `started` | PROTO-005 (Model runs and jobs) | JOBS-002 (Run a model window) | `startModelRuns` |
| `job` | A job and its steps | `run`, `cam`, `hov` | PROTO-005 (Model runs and jobs) | JOBS-003 (jobs tray), JOBS-004 (job window with steps per slide) | `listModelRuns`, `getModelRun`, `cancelModelRun`, `resumeModelRun`, `retryModelRun`, `getProjectJob` |
| `formats` | What files work | `help`, `check` | PROTO-004 (Project page, new project and upload) | RSET-010 (help drawer "What files work?") | `getResultsSchema`, `getResultsTemplate`, `validateResultsFile` |
| `task` | New review task | `slides`, `reviewers`, `find`, `check`, `decision`, `how`, `locks`, `send`, `sent`, `noresult`, `pastdue`, `away`, `retiredtpl`, `nobody` | PROTO-006 (New review task) | TASK-005 (New review task stepper), TASK-009 (study template in a new review task), GUIDE-015 (decision styles with the raw answer and Counts as), TASK-011 (display defaults, locks and presets) | `createReviewTask`, `listStudyTemplates`, `getStudyTemplate`, `listSlideResultSets`, `listTenantMembers`, `listAvailability`, `getOpinionForm`. Decision styles and display locks have no API yet |
| `team` | Team | `open`, `done`, `nudge`, `reassign`, `sent`, `signoff`, `overdue`, `away`, `partial` | PROTO-013 (Team) | TEAM-007 (Team, the researcher's workload view), TASK-007 (nudge, reassign and change a task) | `listTasksAssignedByMe`, `getReviewTaskStates`, `listAvailability`, `nudgeReviewer`, `cancelNudge`, `reassignSlides`, `undoReassignment`. The status words have no API yet |
| `guided` | Guided review | `first`, `region`, `disagree`, `note`, `comments`, `mention`, `grid`, `cellrest`, `cellwhole`, `certainty`, `yesno`, `blind`, `display`, `locked`, `preset`, `done`, `skipped`, `required`, `submitfail`, `connlost`, `slidefail`, `noresults`, `withdrawn`, `signedoff` | PROTO-007 (Guided review, the Slide done card and the next slide) | SHELL-003 (slide top bar), GUIDE-002 (guided review), GUIDE-003 (disagree reasons and optional fixes), GUIDE-007 (Slide done card with the opinion form), GUIDE-008 (How this works), GUIDE-010 (notes on decisions), GUIDE-015 (decision styles with the raw answer and Counts as), TASK-008 (submit a slide review), VIZ-007 (Display panel), COLLAB-005 (Comments tab), COLLAB-006 (mentions), SHELL-010 (error and issue states in every flow) | `getReviewTask`, `getReviewOrder`, `listVerdicts`, `saveVerdict`, `clearVerdict`, `addReviewObject`, `getOpinionForm`, `getOpinion`, `saveOpinion`, `submitSlideReview`, `submitFirstRead`, `getFirstRead`, `getReviewedLayer`. Comments, decision styles and presets have no API yet |
| `next` | Submitted, then the next slide | One state, no scenes | PROTO-007 (Guided review, the Slide done card and the next slide) | TASK-008 (submit a slide review), CASES-020 (next slide in a task) | `submitSlideReview`, `reopenSlideReview`, `getSlideNeighbours`, `getReviewTaskStates` |
| `disagree` | Disagreements | `queue`, `selected`, `sendadj`, `sent`, `adjudicate`, `adjdone`, `lockedqueue`, `declined`, `edited` | PROTO-008 (Disagreements, sign-off and the evaluation report) | ADJ-002 (disagreement queue), ADJ-003 (adjudicator view), ADJ-007 (queue decisions in the task's style and leaving open), ADJ-008 (send to an adjudicator) | `listDisagreements`, `decideDisagreement`, `clearDisagreementDecision`. Sending to an adjudicator has no API yet |
| `signoff` | Sign off the evaluation | `blocked`, `ready`, `ssofail`, `signed`, `amend` | PROTO-008 (Disagreements, sign-off and the evaluation report) | ADJ-004 (sign-off as a soft lock), ADJ-005 (changes after sign-off) | `signOffReviewTask`, `reopenReviewTask`, `getReviewTaskStates` |
| `creport` | Clinical report | `findings`, `staging`, `deposits`, `depadd`, `deprm`, `contra`, `text`, `sign`, `cosign`, `sent`, `signed`, `amended`, `nostaging`, `missing`, `unmeasured`, `dephand`, `amend`, `ssofail` | PROTO-014 (Clinical report, sign-out and co-sign) | REPORT-024 (clinical report model and API), REPORT-025 (clinical report flow page), REPORT-008 (sign-out of a clinical report), REPORT-019 (co-sign of a clinical report) | No API yet. REPORT-024 adds it |
| `cosign` | Co-sign review | `review`, `returned` | PROTO-014 (Clinical report, sign-out and co-sign) | REPORT-019 (co-sign of a clinical report) | No API yet. REPORT-024 adds it |
| `notifs` | Notifications | One state, no scenes | PROTO-003 (Home, My work and the shell) | NOTIF-002 (the bell) | `listNotifications`, `getNotificationCounts`, `markNotificationsRead`, `getNotificationTarget` |
| `case` | Case at low power | `objects`, `open`, `grid`, `running`, `loading`, `unloaded`, `submitfail`, `connlost`, `slidefail`, `noresults`, `withdrawn`, `signedoff`, `slow`, `remoteoff` | PROTO-018 (Full viewer with Objects, Display and Visualize) | SHELL-003 (slide top bar), SHELL-005 (inspector panel with resize and hide), CASE-014 (inspector tabs), CASE-005 (AI state: still running), GUIDE-005 (decisions in the full viewer), GUIDE-007 (Slide done card with the opinion form) as the Opinion tab, VIEW-041 (how a slide loads), SHELL-010 (error and issue states in every flow) | `getCase`, `getReviewTask`, `listSlideResultSets`, `getResultSet`, `listAnnotations`, `listVerdicts`, `saveVerdict`, `getReviewedLayer`, `getOpinion`, `saveOpinion`, `submitSlideReview` |
| `layers` | Visualize results | `panel`, `heat`, `density`, `diff`, `models`, `readers`, `swipe`, `table`, `display`, `locked`, `preset` | PROTO-018 (Full viewer with Objects, Display and Visualize) | VIZ-001 (result sets in the Display panel), VIZ-002 (how objects draw), VIZ-003 (heatmap, density and confidence maps), VIZ-004 (diff and agreement), VIZ-005 (swipe and side by side), VIZ-006 (object table and stats), VIZ-007 (Display panel), TASK-011 (display defaults, locks and presets) | `listSlideResultSets`, `getResultSet`, `getReviewedLayer`, `listVerdicts`. Presets and locks have no API yet |
| `findings` | Full viewer, one object | `open`, `decided`, `added` | PROTO-018 (Full viewer with Objects, Display and Visualize) | GUIDE-005 (decisions in the full viewer), GUIDE-010 (notes on decisions), OBJ-005 (IDs on the slide and in lists) | `listVerdicts`, `saveVerdict`, `getAnnotation`, `listAnnotationHistory` |
| `navigator` | Smart minimap | `overview`, `reading`, `avoid`, `travel`, `cells`, `focus`, `pointer` | PROTO-019 (Viewer tools) | NAV-006 (smart minimap state machine), NAV-007 (minimap placement scoring), NAV-008 (minimap content), NAV-011 (travel animation and route line) | None needed, it runs in the browser |
| `measure` | Measuring | One state, no scenes | PROTO-019 (Viewer tools) | MEAS-001 (ruler tool), MEAS-003 (measurement list in the inspector), MEAS-006 (measure as a step of the area) | No API yet. The MEAS tasks decide it |
| `gallery` | Cells on the slide | `grid`, `rest`, `folded`, `blind` | PROTO-007 (Guided review, the Slide done card and the next slide) | REVIEW-007 (cells gallery in the zone view), GUIDE-002 (guided review), GUIDE-015 (decision styles with the raw answer and Counts as) | `getReviewOrder`, `listVerdicts`, `saveVerdict` |
| `annotate` | Annotate workspace | `auto`, `models` | PROTO-019 (Viewer tools) | ANN-002 (annotate rail with five families), AISEG-010 (auto region tool), AIP-004 (model tier picker) | `listAnnotations`, `createAnnotation`, `changeAnnotation`, `deleteAnnotation` |
| `comments` | Comments on IDs | One state, no scenes | PROTO-007 (Guided review, the Slide done card and the next slide) | COLLAB-003 (comment tool and pins), COLLAB-005 (Comments tab), COLLAB-006 (mentions) | No API yet. COLLAB-002 (threads API) adds it |
| `compare` | Compare slides | `picked`, `picking` | PROTO-019 (Viewer tools) | CMP-001 (split viewer layouts), CMP-004 (pane slide picker) | No API yet. CMP-004 decides it |
| `focus` | Focus mode | One state, no scenes | PROTO-019 (Viewer tools) | SHELL-008 (focus mode) | None needed, it runs in the browser |
| `peek` | Whole-slide peek | One state, no scenes | PROTO-019 (Viewer tools) | NAV-010 (whole-slide peek) | None needed, it runs in the browser |
| `palette` | Command palette | One state, no scenes | PROTO-003 (Home, My work and the shell) | CMD-002 (command palette), HOME-008 (search page) | `search` |
| `signin` | Sign in | `email`, `magic`, `sso`, `forgot`, `reset`, `passkey`, `passkeyqr`, `lock`, `lockkey`, `expired`, `noaccess` | PROTO-009 (Admin, sign-in, sign-up, invite and first-run setup) | ONB-001 (sign-in screens), IAM-021 (lock screen that returns to the same view), IAM-023 (sign in and unlock with a passkey), SHELL-010 (error and issue states in every flow) for expired and no access | `getSession`, `recordActivity`. Sign-in itself runs through the login provider, and Ask for access on the no access scene has no API yet |
| `signup` | Create an account | `form`, `verify` | PROTO-009 (Admin, sign-in, sign-up, invite and first-run setup) | ONB-002 (sign-up and email confirmation) | No API yet. It runs through the login provider |
| `invite` | Invite to review | `landing`, `account` | PROTO-009 (Admin, sign-in, sign-up, invite and first-run setup) | ONB-003 (invite landing) | `acceptInvitation` |
| `setup` | First-run setup | `role`, `workspace`, `project`, `device`, `done` | PROTO-009 (Admin, sign-in, sign-up, invite and first-run setup) | ONB-004 (first-run setup) | `getMe`, `updateMe`, `getCurrentTenant`, `createProject` |
| `settings` | Settings | `display`, `review`, `layout`, `ai`, `nav`, `notify`, `privacy`, `account`, `search`, `keys`, `changed`, `recording`, `conflict`, `reserved`, `safety`, `findkey` | PROTO-016 (Settings, Shortcuts and Developer mode) | SET-002 (settings modal shell), SET-003 (Display section), SET-004 (Layout section), SET-005 (AI and confidence section), SET-006 (Navigation and devices section), SET-007 (Shortcuts section), SET-008 (Notifications section), SET-009 (Privacy and session section), SET-010 (Account section), CMD-004 (key conflict check), CMD-006 (rebinding UI) | `getMe`, `updateMe`, `listNotificationPreferences`, `setNotificationPreferences`, `getMyEmailSchedule`, `setMyEmailSchedule`, `listSessions`, `endSession`, `endOtherSessions`, `getMyAvailability`, `setMyAvailability`, `exportMyPersonalData`. Stored settings have no API yet, SET-001 (settings storage and resolution) adds it |
| `developer` | Developer mode | `renderer`, `tiles`, `annot`, `heatmap`, `models`, `typing`, `job`, `bench`, `hud`, `ref`, `webgpu` | PROTO-016 (Settings, Shortcuts and Developer mode) | LAB-001 (developer drawer), LAB-002 (performance HUD), LAB-004 (pan sweep benchmark and export), LAB-005 (debug handle) | None needed, it runs in the browser |
| `shortcuts` | Shortcuts | `display`, `review`, `layout`, `ai`, `nav`, `notify`, `privacy`, `account`, `search`, `keys`, `changed`, `recording`, `conflict`, `reserved`, `safety`, `findkey` | PROTO-016 (Settings, Shortcuts and Developer mode) | CMD-003 (`?` opens Shortcuts in Settings), SET-007 (Shortcuts section), CMD-006 (rebinding UI) | No API yet. SET-001 (settings storage and resolution) stores the bindings |
| `admin` | Admin | `overview`, `people`, `projects`, `models`, `templates`, `storage`, `api`, `audit`, `security`, `tplnew`, `tpledit`, `addmodel`, `addtested`, `addfail`, `addmap` | PROTO-009 (Admin, sign-in, sign-up, invite and first-run setup) | ADMIN-001 (admin page shell), ADMIN-002 (overview), ADMIN-003 (people and roles), ADMIN-004 (projects), ADMIN-005 (AI models), ADMIN-006 (storage, sources, API and webhooks), ADMIN-007 (audit log and security), ADMIN-008 (report templates). The scenes addmodel, addtested, addfail and addmap go to PROTO-015 | `listTenantMembers`, `changeMemberRole`, `setMemberAdminRights`, `listInvitations`, `createInvitation`, `revokeInvitation`, `listProjects`, `listAuditEvents`, `exportAuditEvents`, `listServiceAccounts`, `createServiceAccount`, `issueApiToken`, `revokeApiToken`, `getSessionPolicy`, `updateSessionPolicy`, `getRetentionPolicy`, `listStudyTemplates`, `createStudyTemplate`, `editStudyTemplate`, `retireStudyTemplate`. AI models and storage sources have no API yet |
| `states` | Issue states | One state, no scenes | PROTO-017 (Issue states index) | SHELL-010 (error and issue states in every flow) | None. Each state reads the API of its own flow |
| `evaluation` | Evaluation report | `report`, `arrange`, `pdf`, `retiredtpl`, `exportfail` | PROTO-008 (Disagreements, sign-off and the evaluation report) | EVAL-002 (evaluation report page), EVAL-003 (exports), EVAL-008 (report from template blocks), EVAL-009 (arrange one report), EVAL-010 (PDF preview) | `getTaskEvaluation`, `getStudyTemplate`, `getStudyTemplateVersion` |

## Small modals

The mock has 16 small modals that share one anatomy, 480 or 560 px wide ([DS-022](../BACKLOG.md), the small modal). They are built with the screen that opens them.

| Modal | Title | Opened from | Built by | Owned later by |
|---|---|---|---|---|
| `runmodel` | Run a model | `runmodel`, the project's More actions | PROTO-005 (model runs and jobs) | JOBS-002 (Run a model window) |
| `addslides` | Add slides | `task/slides` | PROTO-006 (New review task) | TASK-005 (New review task stepper) |
| `dpreview` | Preview the question | `task/decision` | PROTO-006 (New review task) | GUIDE-015 (decision styles with the raw answer and Counts as) |
| `addcls` | Add a class | `project/settings` | PROTO-004 (project page, new project and upload) | PROJ-008 (project settings) |
| `nudge` | Nudge | `team`, `worklist/assigned` | PROTO-013 (Team) | TASK-007 (nudge, reassign and change a task), TEAM-007 (Team workload view) |
| `reassign` | Reassign slides | `team`, `worklist/assigned` | PROTO-013 (Team) | TASK-007 (nudge, reassign and change a task), TEAM-007 (Team workload view) |
| `preset` | Save a preset | `layers/preset`, `guided/preset` | PROTO-018 (full viewer with Objects, Display and Visualize) | VIZ-007 (Display panel), TASK-011 (display defaults, locks and presets) |
| `adj` | Send to an adjudicator | `disagree/selected` | PROTO-008 (disagreements, sign-off and the evaluation report) | ADJ-008 (send to an adjudicator) |
| `signoff` | Sign off RT-14 | `signoff` | PROTO-008 (disagreements, sign-off and the evaluation report) | ADJ-004 (sign-off as a soft lock) |
| `amend` | Amend with a reason | `signoff/amend`, `creport/amended` | PROTO-008 (disagreements, sign-off and the evaluation report) and PROTO-014 (clinical report, sign-out and co-sign) | ADJ-005 (changes after sign-off), REPORT-025 (clinical report flow page) |
| `crdep` | Add a deposit | `creport/depadd` | PROTO-014 (clinical report, sign-out and co-sign) | REPORT-025 (clinical report flow page) |
| `crsign` | Sign out, or Co-sign and sign out | `creport/sign`, `cosign/review` | PROTO-014 (clinical report, sign-out and co-sign) | REPORT-008 (sign-out of a clinical report), REPORT-019 (co-sign of a clinical report) |
| `crreturn` | Return to the author | `cosign/review` | PROTO-014 (clinical report, sign-out and co-sign) | REPORT-019 (co-sign of a clinical report) |
| `tplnew` | New study template | `admin/tplnew` | PROTO-009 (admin, sign-in, sign-up, invite and first-run setup) | ADMIN-008 (report templates) |
| `invite` | Invite people | `admin/people` | PROTO-009 (admin, sign-in, sign-up, invite and first-run setup) | ADMIN-003 (people and roles) |
| `contract` | The model contract | `admin/addmodel` | PROTO-015 (Connect a model) | JOBS-005 (connect a lab model) |

## Mock screens by PROTO task

Every one of the 40 screens is in exactly one PROTO task.

| PROTO task | Screens | Count |
|---|---|---|
| PROTO-003 (Home, My work and the shell) | `home`, `worklist`, `notifs`, `palette` | 4 |
| PROTO-004 (project page, new project and upload) | `project`, `newcase`, `upload`, `formats` | 4 |
| PROTO-005 (model runs and jobs) | `runmodel`, `job` | 2 |
| PROTO-006 (New review task) | `task` | 1 |
| PROTO-007 (guided review, the Slide done card and the next slide) | `guided`, `next`, `gallery`, `comments` | 4 |
| PROTO-008 (disagreements, sign-off and the evaluation report) | `disagree`, `signoff`, `evaluation` | 3 |
| PROTO-009 (admin, sign-in, sign-up, invite and first-run setup) | `signin`, `signup`, `invite`, `setup`, `admin` without its Connect a model scenes | 5 |
| PROTO-012 (How a review works, the flow map) | `flowmap` | 1 |
| PROTO-013 (Team) | `team` | 1 |
| PROTO-014 (clinical report, sign-out and co-sign) | `creport`, `cosign` | 2 |
| PROTO-015 (Connect a model) | The scenes `admin/addmodel`, `admin/addtested`, `admin/addfail` and `admin/addmap` | 0 |
| PROTO-016 (Settings, Shortcuts and Developer mode) | `settings`, `shortcuts`, `developer` | 3 |
| PROTO-017 (issue states index) | `states` | 1 |
| PROTO-018 (full viewer with Objects, Display and Visualize) | `case`, `findings`, `layers` | 3 |
| PROTO-019 (viewer tools) | `navigator`, `measure`, `annotate`, `compare`, `focus`, `peek` | 6 |

The issue scenes are built by the task of the screen they live on. PROTO-017 builds only the index screen, whose buttons open them.

## Kit pages

PROTO-011 (every kit component in rough form) rebuilds the pages that show components or patterns as Storybook pages. The other pages are prose, tables of rules or galleries of mock stills. They stay in the frozen kit as reference and are not rebuilt. The shadcn column says whether a component already in `packages/ui` fits, from the eleven that DS-000 (design system tooling check) set up ([ADR 0130](../adr/0130-shadcn-ui-on-base-ui-with-tailwind-v4.md)).

| Page | Rebuilt | Components on it | Owned by | shadcn fit |
|---|---|---|---|---|
| `pf-brief` Brief | No, prose | None | None | None |
| `pf-personas` Personas | No, prose | Avatar with name and role | DS-014 (avatar, avatar stack, presence dot) | None |
| `pf-journey` Journey, upload to sign-off | No, prose | None | None | None |
| `pf-flow` How a review works | Yes | The flow map with four lanes, boxes and labelled hand-off arrows | PROTO-012 (How a review works, the flow map) | None, custom |
| `pf-pipeline` Pipeline and roles | No, prose | None | None | None |
| `pf-ia` Information architecture | No, prose | None | None | None |
| `pf-ids` ID system | No, prose | Object ID tag | DS-008 (tags) | None, custom |
| `pf-import` Import and sources | No, prose | None | None | None |
| `pf-review` Review, doctors first | No, prose | None | None | None |
| `pf-styles` Decision styles | Yes | Decision buttons in the four styles, the Counts as line with two number steppers and the stacked decision bar | DS-028 (decision buttons in the four decision styles), DS-007 (segmented control, toggle, slider, stepper), DS-019 (progress bar, ring and stacked bar) | Toggle group for the buttons, the rest custom |
| `pf-display` Display panel | Yes | Folding zones with a one-line summary, control rows, a locked control with its reason, the preset menu, Save a preset | DS-018 (surfaces and zones), DS-007 (segmented control, toggle, slider, stepper), DS-011 (popover, dialog, menu, tooltip, toast), DS-022 (small modal) | Toggle group, Switch, Slider, Dropdown menu, Dialog |
| `pf-submit` Submit and Slide done | Yes | The Slide done card, the Before you submit list, the inline error under the primary, the connection lost banner | DS-027 (Before you list with Go to links), SHELL-010 (error and issue states in every flow), GUIDE-007 (Slide done card with the opinion form) | None, custom |
| `pf-team` Team | Yes | Task block, reviewer row with progress bar and status tag, Nudge and Reassign modals, the confirm in the button | DS-019 (progress bar, ring and stacked bar), DS-008 (tags), DS-014 (avatar, avatar stack, presence dot), DS-022 (small modal) | Dialog |
| `pf-clinical` Clinical report and sign-out | Yes | The clinical report flow page, the deposit table, Add a deposit, the sign-out modal with SSO and password, side-by-side co-sign columns | DS-023 (flow page with the shared stepper), DS-026 (table), DS-022 (small modal), DS-020 (type-to-find token field) | Dialog, Combobox |
| `pf-templates` Study templates | Yes | Report page preview, block catalogue, block settings, PDF preview | EVAL-008 (report from template blocks), EVAL-010 (PDF preview), ADMIN-008 (report templates) | None, custom |
| `pf-anatomy` Small modals and flow pages | Yes | Small modal in two widths, flow page with breadcrumb, stepper and sticky bottom bar, the Before you can list | DS-022 (small modal), DS-023 (flow page with the shared stepper), DS-027 (Before you list with Go to links) | Dialog |
| `pf-issues` Error and issue states | Yes | The one banner, the one inline error, the issue index | SHELL-010 (error and issue states in every flow) | None, custom |
| `pf-system` UI kit: tags, icons and type | Yes | The nine tag types, keycap, token, filter chip, five icon sizes, nine type sizes | DS-008 (tags), DS-009 (keycap component), DS-020 (type-to-find token field), DS-004 (icon set with key badges), DS-003 (typography) | Toggle for the filter chip, the rest custom |
| `pf-screens` Hi-fi screens | No, a gallery of mock stills | None | The PROTO screen tasks | None |
| `pf-decisions` Decision log | No, prose | None | None | None |
| `pf-roadmap` Roadmap | No, prose | None | None | None |
| `sa-system` Design system | Yes | Colour tokens in both themes, decision colours, button states, tool rail states, sizes and spacing, class colours, icons with their keys | DS-001 (design tokens package), DS-002 (colour measurement scripts in CI), DS-005 (theme switching), DS-006 (buttons and icon buttons), DS-010 (tool rail button), DS-004 (icon set with key badges) | Button, Tooltip |
| `sa-spec` Interaction spec | No, prose | None | None | None |
| `sa-competitive` Competitive analysis | No, prose | None | None | None |
| `sa-evidence` Research evidence | No, prose | None | None | None |

## Shared components and patterns in the mock

The mock builds every screen from a few shared helpers. Each maps to one owner. Mock-only pieces, the scene chips, the persona chip and the pink mock marker, are never built.

| Component or pattern | Mock helper or class | Owned by | shadcn fit |
|---|---|---|---|
| Colour, surface, size and radius tokens | the `:root` token block | DS-001 (design tokens package) | Tailwind theme variables |
| Buttons, the one primary per screen | `.btn`, `.btn.primary` | DS-006 (buttons and icon buttons) | Button |
| Close cross and icon buttons | `xbtn` | DS-006 (buttons and icon buttons) | Button |
| Segmented control | `seg`, `dvSeg`, `smSeg` | DS-007 (segmented control, toggle, slider, stepper) | Toggle group |
| Number stepper of Counts as | `countsAs` line | DS-007 (segmented control, toggle, slider, stepper) | None, custom |
| Locked control with its reason | `dispRow` locked state | DS-007 (segmented control, toggle, slider, stepper) | None, custom |
| Status, category, object ID, result set and count tags | `nxPill`, `.chip`, `.oid`, `.rs-chip`, `.bd` | DS-008 (tags) | None, custom |
| Filter chip | `.fchip`, `.au-chip` | DS-008 (tags) | Toggle |
| Keycap | `kbd` | DS-009 (keycap component) | None, custom |
| Tool rail button | `rail` | DS-010 (tool rail button) | Toggle |
| Popover, menu, select menu, tooltip, toast | `dropdown`, `toast` | DS-011 (popover, dialog, menu, tooltip, toast) | Popover, Dropdown menu, Tooltip |
| Notifications popover with tabs, unread filter and rows | `nfPanel`, `.nx-notif` | DS-011 (popover, dialog, menu, tooltip, toast), built as `NotificationsPanel` by PROTO-011 | Popover |
| Side drawer with header, scrolling body and footer, with or without a scrim | `.nx-drawer`, `.fmh` | DS-011 (popover, dialog, menu, tooltip, toast), built as `DrawerPanel` by PROTO-011 | Sheet |
| Slide submitted dialog with the next slide and a countdown | `.nx-sub-card` in the `next` scene | GUIDE-007 (Slide done card with the opinion form), built as `SlideSubmittedDialog` by PROTO-011 | Dialog |
| Slides on screen panel of compare view | the `h-sec` Slides on screen section of `compare` | CMP-004 (pane slide picker), built as `SlidesOnScreenPanel` by PROTO-011 | None, custom |
| Fact list of icon, key and value | `kvList` | DS-012 (inspector primitives) | None, custom |
| Cell crop tile in the cells panel | `.cg` tiles | DS-013 (gallery tile) | None, custom |
| Avatar with name | `person` | DS-014 (avatar, avatar stack, presence dot) | None, custom |
| Zones and folding zones with a summary | `zone`, `dvZone` | DS-018 (surfaces and zones) | None, custom |
| Progress bar, ring and stacked decision bar | `pbar`, `pring` | DS-019 (progress bar, ring and stacked bar) | None, custom |
| Type-to-find field with tokens | `.tok` field | DS-020 (type-to-find token field) | Combobox |
| Undo toast | `toastUndo` | DS-021 (undo toast) | None, custom |
| Small modal | `SMD`, `smOpen`, `.sm-scrim` | DS-022 (small modal) | Dialog |
| Flow page with breadcrumb, stepper and sticky bottom bar | `flowPage`, `nxSteps`, `crumbs` | DS-023 (flow page with the shared stepper) | None, custom |
| Text field, textarea, select, checkbox and radio row with label, help and inline error | `smFld`, `smIn`, `nxFld`, `nxIn`, `nxCb`, `nxRadio` | DS-024 (form fields with labels, hints and inline errors) | Input, Input group, Textarea, Select |
| Page tabs, side panel tabs with counts and the quiet tabs of guided review | `.tabs`, `.insp-tabs`, `.app-tabs` | DS-025 (tabs) | Tabs |
| Table | `.nx-tbl` | DS-026 (table) | Table, added by PROTO-011 (every kit component in rough form) |
| Before you submit and Before you can lists with Go to links | `submitBlockers`, `smBlockers` | DS-027 (Before you list with Go to links) | None, custom |
| Decision buttons in the task's style | `gDecision`, `revStyle` | DS-028 (decision buttons in the four decision styles) | Toggle group |
| The one banner and the one inline error | `nxBanner`, `.sm-msg` | SHELL-010 (error and issue states in every flow) | None, custom |
| Global top bar and sidebar | `pfShell`, `pfTop`, `pfSide` | SHELL-002 (global top bar and sidebar) | None, custom |
| Review top bar shared by guided review, the adjudicator view and the full viewer | `reviewTop` | SHELL-003 (slide top bar) | None, custom |
| Side panel of the full viewer | `inspector` | SHELL-005 (inspector panel with resize and hide) | None, custom |
| Magnification bar | `magbar` | NAV-001 (magnification bar) | None, custom |
| Slide done card | `decisionCard` | GUIDE-007 (Slide done card with the opinion form) | None, custom |
| Display panel rows and presets | `dispRow`, `dispPresets` | VIZ-007 (Display panel) | Dropdown menu |
| Flow map | the `flowmap` screen | PROTO-012 (How a review works, the flow map) | None, custom |
