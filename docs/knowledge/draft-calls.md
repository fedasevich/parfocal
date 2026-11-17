# Draft calls

A draft call is an operation in `packages/api-client/src/draft` that only the fake backend answers. OPS-015 (make draft calls safe in production) wrote this inventory on 2026-11-13 and made every draft call fail gracefully when the real API is behind it.

## How a draft call behaves in production

When `fakeApi` is `off`, `apps/web/src/main.tsx` calls `setDraftsAnswered(false)`. From then on `callDraft` in `draft/support.ts` turns a 404 or 405 into `DraftNotAvailableError` (kind `not-found`, code `not-available-yet`).

- A list query answers `[]` and a nullable query answers `null`, so the screen shows its empty state.
- An object query fails without a toast and without a retry. A screen can show the shared notice with `notAvailable(query)` and `<NotAvailableYet what="..." />` from `apps/web/src/shell/not-available.tsx`. The team screen does this.
- A mutation shows one toast saying the action is not available yet.

Three draft paths sit under a real route with a path parameter, so the real API answers 422 instead of 404 and the call fails as an ordinary error. They are `getLabModelConnection` (under `/api/tenant/models/{id}`), `getModelRunDefaults` (under `/api/projects/{id}/model-runs/{id}`) and `listStudyTemplateReviewDefaults` (under `/api/study-templates/{id}`). `listAiModels` gets a 405 because only POST exists on its path, which the mechanism handles.

## Counting them

`node scripts/draft-calls.ts` counts the operations in `packages/api-client/src/draft` per area and prints the total. `pnpm verify` runs it as its last step and never fails on the count, because the count may grow while the UI is built on fakes ([ADR 0295](../adr/0295-ui-first-on-fakes-then-switch-each-area-to-the-real-api.md), UI first on fakes). OPS-017 (switch each area to the real API) reads the count of an area to show it is fully switched. A new operation must be added to the area map in the script, and `scripts/draft-calls.test.ts` fails until it is.

## Promoted

`listMyJobs` (the jobs tray, the job window and the admin shell) and `getMyChecklist` (the getting started card on home) are real routes in `apps/api` since OPS-015.

`createAccount`, `confirmEmail`, `resendEmailCode` and `signInWithPassword` (the sign-up and password sign-in screens) are real routes since IAM-027 (the app's own sign-up and sign-in), together with `getPasswordSignIn`, which tells the web app whether to use them or the hosted login.

The review area switched in OPS-021 (review area on the real API). `listReviewObjects`, `getSlideAgreement` and `getTaskDisplay` live in `apps/api/src/parfocal_api/review_objects.py`, and `getDisagreementQueue`, `updateQueuedObject`, `getMyAdjudication` and `decideAdjudication` in `disagreement_queue.py`. They keep the draft URLs and shapes and are built from stored data: the review order, result objects and cell chunks, review decisions, the disagreement queue and adjudications. The queue actions and the adjudicator's decision call the existing disagreement and adjudication routes, so audit and sign-off rules stay in one place. A queue change after sign-off still answers 409, because the draft body has no change reason. The review object list is not paged, which matters for a whole-slide cell scope. The fake answers these operations through the generated MSW handlers.

The viewer area switched in OPS-022 (viewer area on the real API) and OPS-025 (the viewer typing tool on a GPU typer runner). `getSlideAiProgress`, `listAnnotationLayers` and `getResultSetTyper` live in `apps/api/src/parfocal_api/slide_viewer.py`, `listSlideThreads` and `listThreadComments` in `slide_threads.py`, and `getSlideResultStats` in `slide_result_stats.py`. They keep the draft URLs and are built from stored data. AI progress reads the newest queued or running model run on the slide and maps its tissue, model and object placing stages to the three steps, and `found` stays empty because object IDs are given only at the end of a run. Annotation layers are the project classes counted over the slide's annotations, plus a "No class" and a "Measurements" layer when they hold anything, and a reader who does not see the whole project counts only slide annotations and their own. The typer reads the recorded calibration of the run's typer, answers `calibrated: false` with nulls for cells with no recorded calibration, and answers 404 `no-typer` for a set without cells. AI progress answers ready and the typer answers 403 while the AI is hidden for a first read. Slide threads gather the slide's own threads and those of every task on it the reader can open, through the same sight rules as the thread routes, and a comment has no `reply_to` because messages are flat. Result stats count from the result set, compare the AI with the consensus of the decisions the reader may see, compare with the newest other ready result set on the slide, and give Cohen's kappa for the first two submitted reviewers the reader may see. Dice, the cell agreement and both set IDs are nullable, unlike the draft, because a slide with no decisions or one result set has no honest number. The fake answers these operations through the generated MSW handlers.

`typeOutlines` lives in `apps/api/src/parfocal_api/outline_types.py` and keeps the draft URL. It sends 1 to 500 rings, each at most 512 px wide in slide pixels, through the warm gate to the `outline-types` runner in the embedder pool (`parfocal_ml.outline_typer`), with the registry's single view temperature for `pathosam-hovernext` v1.2, so the answer is calibrated. Any failure or a reply of the wrong length is 503 `typer-offline`, and the web then leaves the accepts untyped. The runner needs `hovernext-pannuke` v1.2 `typer.onnx` in model artifacts, which is not exported yet, so production answers 503 until it is. The fake answers through `fakeTypeOutlinesHandler` in `viewer-tools-handlers.ts`.

The reports area switched in OPS-024 (models, reports, team and admin areas on the real API). `getEvaluationReport` lives in `apps/api/src/parfocal_api/evaluation_report.py` and keeps the draft URL. It has the same gate as the task evaluation, so a reader who does not see the whole project gets 403 `evaluation-hidden`, and it takes the version, the layout and the changes after sign-off from the same stored rows as the PDF. The round name is the task name, because tasks have no rounds, and the template blocks and format are the real report block and format models. The confusion matrix is always empty, because the evaluation gives no AI class to each cell to cross with the consensus, and the screen shows its empty state. The worst objects are the decided AI objects with the most disagreements first. `getClinicalReport`, `getCosignReview`, `cosignClinicalReport` and `returnCosignRequest` live in `clinical_report_views.py` at the draft slide URLs and find the case through the slide. They read the case report and call the existing return and sign routes, so the state, co-signer, sign out right, audit and note length rules stay in one place. The clinical history comes from the sealed clinical note through the case detail, which records the patient view, so a project reviewer without an assignment in the case gets 404 as on the case route. Neither write takes `values` any more, because report text changes only through the case report routes. The co-sign review answers 404 unless the report waits for a co-sign, and its AI part is empty, because no AI deposit size is stored and no screen reads it. The requested by field is always empty, because nothing stores it. The fake answers these operations through the generated MSW handlers.

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
| getModelRunDefaults | run model window | none, path swallowed | medium |
| moveModelRun | job window | none | medium |
| requestProjectAccess | project page without access | none | medium |
| listTeamWorkload | team | none | medium |
| listStudyTemplateReviewDefaults | study templates | none, path swallowed | medium |
| getAdminOverview, getStorageUsage, getSecuritySettings, listReviewerWorkload, listWebhooks, listAiModels | admin console | none | low |
| getLabModelConnection | connect a model | none, path swallowed | low |
| getInvitePreview | invitation page | partly, invitations | low |
| getSignInOptions, signInWithCode, requestSignInLink, startSso, requestPasswordReset, resetPassword | sign in screens, replaced by Zitadel | Zitadel | low |
