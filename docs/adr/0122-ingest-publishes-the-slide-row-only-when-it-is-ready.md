# 0122. The ingest job creates the slide row only when the slide is ready, and the upload carries the status until then

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: INGEST-017 (publish step and slide status). Touches SEC-009 (slide label and macro image handling), INGEST-018 (ingest failure UX), INGEST-022 (per-file problems in the Check step), RSET-004 (pairing results with slides) and CASES-024 (sorting dropped files into cases)

## Context

INGEST-017 (publish step and slide status) asks that an uploaded slide becomes viewable in its project and case on success and that the client sees it move from uploading to processing to ready. INGEST-001 (upload API with presigned multipart) stores an `uploads` row from the first request and queues the ingest job when the upload completes. The `slides` table had no status and no file facts. Every query that shows slides (a case, Home, review task slide pickers, result set creation, the inbox) only filters `deleted_at IS NULL`, and labels were unique per case even for deleted slides. [ADR 0069](0069-slide-pipeline.md) (slide pipeline) says the uploaded state is the slide row and its ingest status. There is no realtime transport yet, because STACK-024 (realtime transport) is undecided. Labels and macros can hold names and barcodes, and SEC-009 (slide label and macro image handling) has not decided who may see them.

## Options considered

1. A slide row from `createUpload` on, with a status column that moves from uploading through processing to ready or failed. The slide id exists from the start, but every slide query must learn to hide unfinished and failed slides, a failed or cancelled upload leaves a row that holds its label, and a cancelled upload needs its slide cleaned up.
2. No slide row until the ingest job publishes it. The upload row and its job carry the status until then, and a status route keyed by the upload id derives uploading from an open upload, processing from a completed upload whose job has not published, ready from the published slide and failed from a cancelled upload or the job's failure code. No existing query changes, because every slide row is a ready slide or a row made before this record (case imports and tests). The slide id is chosen by the job's first step, so derived files can be written under it before the row exists.
3. A separate `slide_files` table next to `slides`, with the status and facts per file. It keeps `slides` small and would allow a file to be replaced later, but every reader of a slide then joins a second table, and nothing needs more than one file per slide yet.

## Decision

Option 2. It keeps unfinished and refused files out of every slide list without touching those lists, and it keeps a refused file from ever becoming a slide.

| Concern | Rule |
|---|---|
| Status route | `GET /api/uploads/{upload_id}/status` (`getUploadStatus`), for the person or service account that created the upload, answers `uploading`, `processing` with the running step, `ready` with the slide id and its notices, or `failed` with a reason code and a plain message. Clients poll it until STACK-024 (realtime transport) picks a push channel |
| Steps | The ingest steps run in the order quarantine, identify, scan, validate, index, derive, publish. Identify now comes before scan, because the structure check needs the format |
| Reading the file | Each step that reads pixels makes sure the file is on the worker's disk and downloads it again when a new worker resumes the job, because OpenSlide needs a local path and an MRXS slide needs its folder, as [ADR 0043](0043-server-slide-reading.md) (server slide reading) rule 8 says. The download computes the SHA-256 of record that [ADR 0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) names |
| Keys | The original moves from `t/{tenant}/quarantine/{upload}/{name}` to `t/{tenant}/s/{slide}/original{.ext}`, keeping only a known extension, so the published key holds no file name. The level table, thumbnail, overview and tissue mask sit next to it. Label and macro images go to `t/{tenant}/restricted/{slide}/`, a prefix of their own that no route serves until SEC-009 (slide label and macro image handling) decides who may see them |
| Moving out of quarantine | A multipart copy with `UploadPartCopy` in 1 GiB parts, then a delete of the quarantine object, because a single copy stops at 5 GiB and slides reach 7 GB. A refused file is deleted from quarantine |
| Publishing | The publish step inserts the slide with its facts, records `slide.published` in the audit log and sends the uploader an `upload-done` notification in one transaction, and does nothing when the upload already has a slide, so a rerun after a crash adds nothing |
| Labels | The label is the file name without its extension. When the case, or the project for a slide without a case, already has that label, the slide gets "(2)", "(3)" and so on. Label uniqueness now ignores deleted slides, as [ADR 0019](0019-soft-delete-policy.md) (soft delete policy) asks |
| Failure | A refused file ends the job with its reason code, records `upload.refused` and sends no notification, because the `upload-done` line says the upload is ready |

## Consequences

- Migration `0047` (slide ingest) adds the file facts and `upload_id` to `slides`, a unique key on `uploads (id, project_id)` for the composite foreign key, and partial label indexes.
- The ingest worker depends on `parfocal-api` for the slide tables, the audit log and notifications, as the result set import already planned to.
- SEC-009 (slide label and macro image handling) decides who reads `t/{tenant}/restricted/`. SEC-008 (de-identified projects) may decide not to extract labels at all in de-identified projects.
- INGEST-018 (ingest failure UX) shows the reason codes and decides whether a failed upload gets its own notification kind and wording.
- INGEST-022 (per-file problems in the Check step) decides whether a duplicate is skipped before upload. Until then a second file with the same name is kept with a numbered label.
- A slide registered by a case import without a file is not filled by an upload of the same name yet. CASES-024 (sorting dropped files into cases) and INGEST-021 (upload wizard with slides and results) decide that matching.
- R2's support for `UploadPartCopy` with `x-amz-copy-source-range` is taken from its S3 compatibility page and is unverified until INGEST-028 (upload protocol check on the R2 dev bucket) runs.
