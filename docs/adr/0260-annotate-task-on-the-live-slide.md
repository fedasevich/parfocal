# 0260. Annotate task on the live slide with a drafted AI object read

- Date: 2026-11-08
- Status: Accepted
- Deciders: Claude
- Backlog: ANN-031, ANN-030, TASK-014, ANN-032

## Context

ANN-031 (annotate task on screen) puts an annotate task slide on screen with the task's classes, the shared layer of [ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer), the AI result with a toggle, origin marks, counts per class, progress across the task's slides and the check and sign-off of [ADR 0247](0247-annotate-slide-checks-and-sign-off.md) (annotate slide checks and sign-off). Two screens could carry it. The PROTO-020 annotate task screen draws fake shapes over a still image, and the live slide route draws real shapes on the viewer engine with the polygon, count marker and autosave work already done. The API reads the shared layer, which holds only drawn shapes and copies of AI objects, and has no read of the AI objects of a result set with their outlines.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Wire the live slide route, and draft a read of a slide's AI objects with outlines | Real drawing, autosave and keys already work there, the prototype stays a design reference | The AI read is fake until the API serves it |
| 2. Wire the PROTO-020 screen to the API | Its layout already matches the design | Its canvas is a still image with fake coordinates, so drawing and saving would be built twice |
| 3. Read AI objects from the review objects draft | No new draft | That list has no outlines and belongs to review tasks |

## Decision

Option 1. An annotate task opened on the live slide saves through the shared layer transport, takes its class strip from the task's class snapshot, and shows a task panel with the AI result toggle, the objects with origin marks, counts per class, check progress, progress across the task's slides, the checked card and, for a project owner once every expert has checked, the sign-off card. The draft `listSharedAiObjects` reads `GET /api/review-tasks/{task}/slides/{slide}/shared-layer/ai` with each AI object's ID, class, score and outline. It and the check, sign-off and AI object calls are defined in `apps/web/src/annotations/annotate-task-api.ts` behind the lazy slide route, not in the API client, because code in the API client lands on the first page and the first page is at its gzip budget ([ADR 0048](0048-routing.md), routing). Confirming, deleting and the check and sign-off calls use the ANN-030 (shared layer API) and TASK-014 (check and sign off an annotate slide) endpoints as built.

## Consequences

- The API needs the AI object read before the panel works outside the fake API, which ANN-040 (serve a slide's AI objects for an annotate task) builds.
- The PROTO-020 screens stay as the design reference and are not wired.
- Polygons now save their class, which the slide annotation API already accepted.
