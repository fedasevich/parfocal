# XXXX. Ingest failures have two classes, set by the server, and a refused file sends an upload refused notification

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-018 (ingest failure UX). Follows ADR 0122 (the ingest job creates the slide row only when the slide is ready), which left the failure wording and the notification to this task. INGEST-022 (per-file problems in the Check step) reuses it.

## Context

The upload status route already answers `failed` with a reason code and a plain message. A person who sees "Upload it again" next to a refused Zeiss CZI file is misled, and a person who sees "Export the slide as OME-TIFF" next to a half-sent file is as well. The screen needs to know whether sending the same file again can work. ADR 0122 sent no notification for a refused file, because the upload-done line says the upload is ready. The owner chose on 2026-11-02 that a refused file sends the uploader an in-app notification of a new kind with its own line.

## Options considered

1. Classify on the client from the reason code. The client then needs a copy of every code, and a code added to the worker silently falls into the wrong class.
2. Classify on the server and send the class in the status route. One table of codes lives next to the messages in `parfocal_common.ingest`, a test fails when a known code has no message, and an unknown code is permanent.
3. Make every failure retryable. This is the simplest screen, and it makes people re-send a 7 GB file that can never pass.

## Decision

Option 2.

| Concern | Rule |
|---|---|
| Classes | `transient` means that sending the same file again can work: a file missing from storage, a size mismatch, a cancelled or expired upload, a check that was stopped, and a truncated file. `permanent` means everything else, including every format refusal and every result import failure. An unknown code is permanent |
| Status route | `GET /api/uploads/{upload_id}/status` adds `failure_class`, `transient` or `permanent` when the status is `failed`, and `null` otherwise |
| Screen | A transient failure shows its message and a Try again button. A permanent failure shows its message and a Contact support link, never a retry. The link is a `mailto:` to the support address with the reason code in the subject, and carries no file name |
| Notification | A new kind `upload-refused`, target kind job, is sent to the uploader in the same transaction that records `upload.refused`. Its payload holds the upload id, the reason code and the plain message, and no file name. It is quiet like `upload-done`: in the app and live, no email. It does not break a mute. The bell shows it in the Jobs tab |
| Migration | `0078` widens the kind check on `notifications` and `notification_preferences` by one value. Its downgrade deletes rows of the new kind first |

## Consequences

- The support address `support@parfocal.eu` is a placeholder in `apps/web/src/upload/ingest-failure.ts`. TODO: the owner confirms the address or gives another.
- The Try again button calls whatever resends the file. The upload engine's retry does that for a stopped upload. A check that was stopped is resent by uploading the file again until the job route offers a retry of one ingest job.
- ADR 0122's line "a refused file sends no notification" no longer holds. The upload-done notification is still not sent for a refused file.
- A failure of the job itself that is not a refusal, such as a worker crash with no reason code, does not send the new notification. It shows as `unknown`, which is permanent, until INGEST-022 (per-file problems in the Check step) decides how crashes are told apart from refusals.
