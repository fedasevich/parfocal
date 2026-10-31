# 0124. Label and macro images are shown only in clinical projects, to the people who read the whole project, and every read is audited

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: SEC-009 (slide label and macro image handling). Touches SEC-008 (de-identified projects), PROJ-002 (privacy modes), TILES-001 (signed access to slide bytes), SEC-006 (retention policies) and SEC-007 (right to access and erasure workflows)

## Context

A slide file carries two pictures next to the tissue: the label, a photo of the sticker on the glass, and the macro, a photo of the whole glass. Both can show a patient's name, an accession number or a barcode. INGEST-017 (publish step and slide status) stores them as `label.png` and `macro.jpg` under `t/{tenant}/restricted/{slide}/`, apart from the slide's other files, and records which exist in `slides.restricted_images` ([ADR 0122](0122-ingest-publishes-the-slide-row-only-when-it-is-ready.md), the slide row appears only when it is ready). No route served them.

SEC-009 asks that they are "shown only to permitted roles, and excluded from guest and research access". Since [ADR 0053](0053-ai-results-review-direction.md) (AI results review direction) there are no guests, and the guest scope was removed by [ADR 0060](0060-no-sign-out-permissions-or-guest-scope.md) (no sign-out permissions or guest scope). Research access now means a de-identified project, which PROJ-002 (privacy modes) says "hides label and macro images" and SEC-008 (de-identified projects) says must never hold a direct identifier. A clinical project allows patient data, which its owners and viewers already read in the case view, and which a researcher outside the project reads only through emergency access with a reason ([ADR 0066](0066-emergency-access-per-clinical-project.md), emergency access per clinical project). A project reviewer sees only the slides of their tasks and judges AI output on them ([ADR 0065](0065-project-role-enforcement.md), project role enforcement, and [ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md), researcher and reviewer with admin rights).

Looking at the fixtures showed that the macro is no safer than the label. The macros of `CMU-1.ndpi`, `Leica-1.scn`, `OS-1.bif` and `Argos-1.avs` show the label area with handwriting, numbers or a barcode, while the Aperio, Philips and CAMELYON macros crop or darken it. The rendered thumbnail and overview never show it, because they are drawn from the slide's level 0 area ([ADR 0075](0075-slide-thumbnails-and-overviews.md), slide thumbnails and overviews). The original file itself still holds the label and macro pages on most formats, which matters once TILES-001 (signed access to slide bytes) serves byte ranges of it.

## Options considered

### Who sees them in a clinical project

1. Everyone who may open the slide, task reviewers included. A reviewer could check that the slide is the right one, but the reviewers of an AI study do not need to know whose tissue it is, and every task would spread names to more people.
2. The people who read the whole project: project owners and viewers, whatever their workspace role, and a researcher with open emergency access. This is the same group that sees the patient in the case view today, so a label tells them nothing new.
3. Project owners only. The narrowest, but a viewer already reads the patient's name in the case, so hiding the label from them protects nothing.

### How the rule is written

1. Keep `see-slides` and add a check in the route. Nothing changes in the matrix, but the permission page would not show the rule, and a service account with the `see-slides` scope would read labels.
2. A new permission `see-labels` in both matrices. The researcher has it, a workspace reviewer has it view only, and in a project the owner and viewer have it and the reviewer does not. The page shows the rule, emergency access opens it like `see-slides`, and service accounts never get it, because no scope names it.

### How the bytes reach the browser

1. The API reads the object from storage and returns it with `Cache-Control: private, no-store`. One request per image, and the API can write the audit entry for the read it served.
2. A short-lived signed GET URL. It saves the API the bytes, but the API signs no reads yet, a URL can leak through logs and the `Referer` header, and the read would happen after the audit entry. Signing slide reads belongs to TILES-001 (signed access to slide bytes) and STACK-025 (object storage, CDN and signed access), which this record does not decide.

## Decision

Option 2 for who sees them (the people who read the whole project), option 2 for the rule (a new permission `see-labels`) and option 1 for the bytes (read through the API).

| Concern | Rule |
|---|---|
| Route | `GET /api/slides/{slide_id}/restricted-images/{image}` (`getRestrictedImage`), with `image` `label` or `macro`, returns `image/png` or `image/jpeg` with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff` |
| Order of checks | The workspace gate `see-labels` (403 `forbidden` for a service account). A slide that is missing, deleted or in another workspace is 404 `not-found`. A slide the caller cannot read follows `require_slide_reading`: 404, or 403 `emergency-access-needed` for a researcher outside a clinical project. A de-identified project is 404 `restricted-image-not-found` for everyone. A reader who does not read the whole project, which is an assigned reviewer, is 403 `restricted-images-for-readers`. An image the slide does not have, or that storage no longer holds, is 404 `restricted-image-not-found` |
| De-identified projects | Never shown to anyone, the owner included, by any route |
| Audit | Every served image records `slide.restricted-image-viewed` on the slide with `{"image": "label"}` or `{"image": "macro"}` and nothing else. Refusals record nothing. The audit query for a patient includes these entries for the slides of their cases |
| Case view | `getCase` lists `restricted_images` per slide, the kinds the caller may open, and an empty list for everyone else |
| Patient access export | `exportPatientData` lists the kinds held per slide, and the owner opens them through the route |
| Patient erasure | `erasePatient` deletes the label and macro of every slide in the patient's cases and empties `restricted_images`, because those slides stay as de-identified data ([ADR 0090](0090-access-export-and-erasure.md), access export and erasure). The answer and the audit entry carry `restricted_images_deleted` |
| Retention | When `parfocal_retention_purge()` removes a slide, the same transaction deletes every object under the slide's two prefixes, and its `retention.purged` entry carries the number of files. A storage failure rolls the purge back, so no slide row disappears while its files stay |

## Consequences

- `see-labels` is in the [permission page](../reference/permissions.md), and `project_access.project_grant` opens it through emergency access like `see-slides`.
- The workspace reviewer seat of the permission matrix test is a project viewer and reads the seeded label, the tenant isolation suite and the project role test call the route, and `test_restricted_images.py` holds the table of roles in a clinical and a de-identified project.
- The generated client returns a `Blob` for image answers. A screen can also use the route as an `<img>` source, because the session cookie is same-origin.
- The retention workflow takes the storage location from the API settings, so the purge needs storage to be reachable. This settles the TODO in [ADR 0089](0089-retention-purge-and-audit-re-anchor.md) (retention purge and audit re-anchor) for slide files. Result set files are still not deleted.
- SEC-008 (de-identified projects) decides whether ingest stops extracting them in a de-identified project at all, and what a switch from de-identified to clinical shows. Decision 10d (labels in a de-identified project at ingest) in [decisions.md](../decisions.md) asks the owner.
- TILES-001 (signed access to slide bytes) must keep the label and macro pages of the original file out of reach, or a reviewer could read the label from the original. Decision 10e (how the original keeps its label pages out of reach) asks the owner how. Its backlog entry now says so.
- A project cannot switch labels off yet. Decision 10c (a switch per clinical project) asks whether it should, with PROJ-008 (project settings).
- TODO: the number 0124 was free on `origin/main` on 2026-10-31. If another branch takes it first, renumber this record.
