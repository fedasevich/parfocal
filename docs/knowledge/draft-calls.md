# Draft calls

A draft call is an operation in `packages/api-client/src/draft` that only the fake backend answers. OPS-015 (make draft calls safe in production) wrote this inventory on 2026-11-13 and made every draft call fail gracefully when the real API is behind it.

## How a draft call behaves in production

When `fakeApi` is `off`, `apps/web/src/main.tsx` calls `setDraftsAnswered(false)`. From then on `callDraft` in `draft/support.ts` turns a 404 or 405 into `DraftNotAvailableError` (kind `not-found`, code `not-available-yet`).

- A list query answers `[]` and a nullable query answers `null`, so the screen shows its empty state.
- An object query fails without a toast and without a retry. A screen can show the shared notice with `notAvailable(query)` and `<NotAvailableYet what="..." />` from `apps/web/src/shell/not-available.tsx`. The team screen does this.
- A mutation shows one toast saying the action is not available yet.

Three draft paths sit under a real route with a path parameter, so the real API answers 422 instead of 404 and the call fails as an ordinary error. They are `getLabModelConnection` (under `/api/tenant/models/{id}`), `getModelRunDefaults` (under `/api/projects/{id}/model-runs/{id}`) and `listStudyTemplateReviewDefaults` (under `/api/study-templates/{id}`). `listAiModels` gets a 405 because only POST exists on its path, which the mechanism handles.

## Promoted

`listMyJobs` (the jobs tray, the job window and the admin shell) and `getMyChecklist` (the getting started card on home) are real routes in `apps/api` since OPS-015.

`createAccount`, `confirmEmail`, `resendEmailCode` and `signInWithPassword` (the sign-up and password sign-in screens) are real routes since IAM-027 (the app's own sign-up and sign-in), together with `getPasswordSignIn`, which tells the web app whether to use them or the hosted login.

## Remaining drafts

High priority sits on the home, project, viewer, review and annotate paths.

| Operation | Screen | Real equivalent | Priority |
|---|---|---|---|
| getProjectOverview | project page, settings and slides tabs | none | high |
| listProjectSlides | run model window, new task, compare view | partly, the project slide list | high |
| getSlideAiProgress | full viewer | none | high |
| getSlideResultStats | full viewer and review | none | high |
| getResultSetTyper | full viewer | none | high |
| listReviewObjects | review | partly, result objects | high |
| getSlideAgreement | review | none | high |
| getTaskDisplay | review display tab | none | high |
| listAnnotationLayers | annotate view | partly, annotation sets | high |
| getProjectImports | project settings and upload | none | high |
| getUploadBatch | upload page | partly, uploads | high |
| getProjectScopeOptions | new task | none | high |
| getReviewTaskDefaults | new task | none | high |
| listSlideThreads | viewer comments | partly, threads | high |
| listThreadComments | viewer comments | partly, thread messages | high |
| typeOutlines | viewer typing tool | none | high |
| getModelRunDefaults | run model window | none, path swallowed | medium |
| moveModelRun | job window | none | medium |
| requestProjectAccess | project page without access | none | medium |
| listTeamWorkload | team | none | medium |
| getDisagreementQueue, getMyAdjudication, decideAdjudication, updateQueuedObject | disagreements | none | medium |
| getEvaluationReport | evaluation report | partly, task evaluation | medium |
| getClinicalReport, getCosignReview, cosignClinicalReport, returnCosignRequest | clinical report and cosign | partly, case reports | medium |
| listStudyTemplateReviewDefaults | study templates | none, path swallowed | medium |
| getAdminOverview, getStorageUsage, getSecuritySettings, listReviewerWorkload, listWebhooks, listAiModels | admin console | none | low |
| getLabModelConnection | connect a model | none, path swallowed | low |
| getInvitePreview | invitation page | partly, invitations | low |
| getSignInOptions, signInWithCode, requestSignInLink, startSso, requestPasswordReset, resetPassword | sign in screens, replaced by Zitadel | Zitadel | low |
