# Draft calls

A draft call is an operation in `packages/api-client/src/draft` that only the fake backend answers. OPS-015 (make draft calls safe in production) wrote this inventory on 2026-11-13 and made every draft call fail gracefully when the real API is behind it.

## How a draft call behaves in production

When `fakeApi` is `off`, `apps/web/src/main.tsx` calls `setDraftsAnswered(false)`. From then on `callDraft` in `draft/support.ts` turns a 404 or 405 into `DraftNotAvailableError` (kind `not-found`, code `not-available-yet`).

- A list query answers `[]` and a nullable query answers `null`, so the screen shows its empty state.
- An object query fails without a toast and without a retry. A screen can show the shared notice with `notAvailable(query)` and `<NotAvailableYet what="..." />` from `apps/web/src/shell/not-available.tsx`. The team screen does this.
- A mutation shows one toast saying the action is not available yet.

One draft path sits under a real route with a path parameter, so the real API answers 422 instead of 404 and the call fails as an ordinary error. It is `listStudyTemplateReviewDefaults` (under `/api/study-templates/{id}`).

## Counting them

`node scripts/draft-calls.ts` counts the operations in `packages/api-client/src/draft` per area and prints the total. `pnpm verify` runs it as its last step and never fails on the count, because the count may grow while the UI is built on fakes ([ADR 0295](../adr/0295-ui-first-on-fakes-then-switch-each-area-to-the-real-api.md), UI first on fakes). OPS-017 (switch each area to the real API) reads the count of an area to show it is fully switched. A new operation must be added to the area map in the script, and `scripts/draft-calls.test.ts` fails until it is.

## Promoted

`listMyJobs` (the jobs tray, the job window and the admin shell) and `getMyChecklist` (the getting started card on home) are real routes in `apps/api` since OPS-015.

`createAccount`, `confirmEmail`, `resendEmailCode` and `signInWithPassword` (the sign-up and password sign-in screens) are real routes since IAM-027 (the app's own sign-up and sign-in), together with `getPasswordSignIn`, which tells the web app whether to use them or the hosted login.

The review area switched in OPS-021 (review area on the real API). `listReviewObjects`, `getSlideAgreement` and `getTaskDisplay` live in `apps/api/src/parfocal_api/review_objects.py`, and `getDisagreementQueue`, `updateQueuedObject`, `getMyAdjudication` and `decideAdjudication` in `disagreement_queue.py`. They keep the draft URLs and shapes and are built from stored data: the review order, result objects and cell chunks, review decisions, the disagreement queue and adjudications. The queue actions and the adjudicator's decision call the existing disagreement and adjudication routes, so audit and sign-off rules stay in one place. A queue change after sign-off still answers 409, because the draft body has no change reason. The review object list is not paged, which matters for a whole-slide cell scope. The fake answers these operations through the generated MSW handlers.

The viewer area switched in OPS-022 (viewer area on the real API), except `typeOutlines`. `getSlideAiProgress`, `listAnnotationLayers` and `getResultSetTyper` live in `apps/api/src/parfocal_api/slide_viewer.py`, `listSlideThreads` and `listThreadComments` in `slide_threads.py`, and `getSlideResultStats` in `slide_result_stats.py`. They keep the draft URLs and are built from stored data. AI progress reads the newest queued or running model run on the slide and maps its tissue, model and object placing stages to the three steps, and `found` stays empty because object IDs are given only at the end of a run. Annotation layers are the project classes counted over the slide's annotations, plus a "No class" and a "Measurements" layer when they hold anything, and a reader who does not see the whole project counts only slide annotations and their own. The typer reads the recorded calibration of the run's typer, answers `calibrated: false` with nulls for cells with no recorded calibration, and answers 404 `no-typer` for a set without cells. AI progress answers ready and the typer answers 403 while the AI is hidden for a first read. Slide threads gather the slide's own threads and those of every task on it the reader can open, through the same sight rules as the thread routes, and a comment has no `reply_to` because messages are flat. Result stats count from the result set, compare the AI with the consensus of the decisions the reader may see, compare with the newest other ready result set on the slide, and give Cohen's kappa for the first two submitted reviewers the reader may see. Dice, the cell agreement and both set IDs are nullable, unlike the draft, because a slide with no decisions or one result set has no honest number. The fake answers these operations through the generated MSW handlers.

`typeOutlines` stays a viewer draft. It needs a typer runner on the GPU pool behind the warm gate, which does not exist yet.

OPS-024 (models, reports, team and admin areas on the real API) switched three model calls, all in `apps/api/src/parfocal_api/model_area.py` and registered before the routes with a path parameter. `getModelRunDefaults` offers the project's slides that have no result set yet and the first catalogue model that is not hidden. `listAiModels` lists the catalogue models with their hidden state and the tenant's lab models, counts result sets by the name a run gives them, and lists the run batches that still have a queued or running slide. `getLabModelConnection` prefills the connect form from the latest connected lab model and answers 404 when there is none, so the screen starts blank. Its test is always `untested`, and `tiles_at_once` and `health_check_minutes` are the constants the screen already showed, because nothing stores them yet.

## Remaining drafts

High priority sits on the home, project, viewer, review and annotate paths.

| Operation | Screen | Real equivalent | Priority |
|---|---|---|---|
| getProjectOverview | project page, settings and slides tabs | none | high |
| listProjectSlides | run model window, new task, compare view | partly, the project slide list | high |
| getProjectImports | project settings and upload | none | high |
| getUploadBatch | upload page | partly, uploads | high |
| getProjectScopeOptions | new task | none | high |
| getReviewTaskDefaults | new task | none | high |
| typeOutlines | viewer typing tool | none, needs a GPU typer runner | high |
| moveModelRun | job window | none | medium |
| requestProjectAccess | project page without access | none | medium |
| listTeamWorkload | team | none | medium |
| getEvaluationReport | evaluation report | partly, task evaluation | medium |
| getClinicalReport, getCosignReview, cosignClinicalReport, returnCosignRequest | clinical report and cosign | partly, case reports | medium |
| listStudyTemplateReviewDefaults | study templates | none, path swallowed | medium |
| getAdminOverview, getStorageUsage, getSecuritySettings, listReviewerWorkload, listWebhooks | admin console | none | low |
| getInvitePreview | invitation page | partly, invitations | low |

## Deleted

OPS-024 (models, reports, team and admin areas on the real API) deleted `getSignInOptions`, `signInWithCode`, `requestSignInLink`, `startSso`, `requestPasswordReset` and `resetPassword`, because the hosted Zitadel login does single sign-on, sign-in links and password resets. The sign-in screen lost its link, single sign-on, forgot and reset scenes, and sign-up lost its single sign-on button. The lock and expired scenes read the idle lock and session length from the real session policy, and the lock and passkey scenes land on `return_to` or home.
