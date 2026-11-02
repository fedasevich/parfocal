# Records accepted under standing approval

The owner asked on 2026-11-02 for a one-page summary of the records agents accepted on 2026-10-17 and 2026-10-18, ADR 0054 (hospital code inventory and revert order) through ADR 0091 (notification catalogue and targets). Each line says what the record settled. Open a record only when a line surprises you, and write in [decisions.md](../decisions.md) to reopen one. Risk R12 in [risks.md](risks.md) (records accepted faster than reviewed) closes when you have read this page.

## The pivot away from hospital sign-out

- [0054](../adr/0054-hospital-code-inventory-and-revert-order.md) The hospital code was reverted first, then the roles changed, then cases moved into projects.
- [0056](../adr/0056-no-signing-rights.md) Signing rights, supervision and stored signatures are gone.
- [0057](../adr/0057-no-case-state-machine.md) Cases have no state machine. The slide pipeline per task replaces it.
- [0058](../adr/0058-typed-case-ids.md) Case IDs are typed or come from file names. Accession templates are gone.
- [0059](../adr/0059-no-folders.md) Folders are gone.
- [0060](../adr/0060-no-sign-out-permissions-or-guest-scope.md) Sign-out permissions, the outside consultant and the guest scope are gone.

## People, projects and access

- [0055](../adr/0055-away-until-with-a-note.md) A person is available or away, with an optional end date and note.
- [0061](../adr/0061-researcher-reviewer-and-admin-roles.md) Workspace and project roles. Since replaced by ADR 0096 (researcher and reviewer with admin rights).
- [0062](../adr/0062-project-model.md) and [0063](../adr/0063-cases-and-slides-in-projects.md) Projects hold optional cases, slides and result sets, need a membership to open and own their patients.
- [0064](../adr/0064-project-api.md) Projects are numbered per workspace, members read, owners change, and projects are archived instead of deleted.
- [0065](../adr/0065-project-role-enforcement.md) A project role narrows the workspace role. Project owners are always researchers.
- [0066](../adr/0066-emergency-access-per-clinical-project.md) Emergency access opens one clinical project for a set time, with a reason.
- [0087](../adr/0087-origin-check-on-cookie-writes.md) Cookie writes must come from the app's own origin.
- [0088](../adr/0088-rate-limits-in-postgres-and-at-the-edge.md) Rate limits per person and workspace live in Postgres, and limits per IP sit at the edge.

## Slides, results and review

- [0067](../adr/0067-class-taxonomy-and-colour-check.md) A project has up to nine classes on keys 1 to 9, with colours checked for colour-blind readers.
- [0069](../adr/0069-slide-pipeline.md) A slide's step in the pipeline comes from stored facts. People only submit, reopen and sign off.
- [0070](../adr/0070-result-file-parsers.md) Result files of every POC format are read into one object form, with Parfocal JSON v1 as the native format.
- [0071](../adr/0071-object-id-grammar.md) Object IDs are a kind letter and a number per slide, and they carry across result sets by overlap or a 4 µm centre distance.
- [0075](../adr/0075-slide-thumbnails-and-overviews.md) Thumbnails are 256 px and overviews 1024 px JPEG renders.
- [0076](../adr/0076-annotation-and-ai-result-storage.md) AI cells live as binary chunks in object storage. Regions and human outlines are database rows.
- [0077](../adr/0077-result-sets.md) A result set is immutable once imported and is only soft-deleted.
- [0078](../adr/0078-review-task-model.md) A review task pins one result set per slide and opens its slides to its reviewers.
- [0079](../adr/0079-reviewed-layer.md) A reviewer's fixes are one edit row per object, plus added objects.
- [0072](../adr/0072-decisions-reasons-and-opinion-forms.md) A decision is one current answer per reviewer and object with a coded reason, and the opinion form is a versioned list of questions.
- [0080](../adr/0080-disagreement-rule-and-sign-off.md) Reviewers who differ, or a majority against the AI, make a disagreement. Sign-off needs every slide submitted and no open disagreement.
- [0081](../adr/0081-uploads-are-checked-by-structure.md) Uploads are checked by their file structure, with no antivirus scanner.
- [0086](../adr/0086-node-staging-rules.md) Lymph node staging is a pure function over the measured areas.

## Evaluation and reports

- [0084](../adr/0084-evaluation-metrics.md) Metrics count AI objects against the reviewers' consensus, with kappa between reviewers.
- [0083](../adr/0083-typst-for-report-pdfs.md) Report PDFs are rendered by Typst and are the same bytes every time.

## Home, notifications and audit

- [0082](../adr/0082-my-work-query-api.md) My work is three read endpoints, one per tab.
- [0085](../adr/0085-home-aggregate-api.md) Home is one read, and "resume" comes from review activity.
- [0074](../adr/0074-notifications-as-rows-with-an-email-outbox.md) Notifications are rows routed by each person's preferences, and email leaves from an outbox after the commit.
- [0091](../adr/0091-notification-catalogue-and-targets.md) One catalogue of notification kinds, each with a target and a template.
- [0073](../adr/0073-audit-queries-and-signed-export.md) Admins query the audit log, and its exports are signed per workspace.
- [0068](../adr/0068-structured-logging-on-the-standard-library.md) JSON logs from the standard library, one access line per request.
- [0089](../adr/0089-retention-purge-and-audit-re-anchor.md) One database function purges expired soft-deleted records.
- [0090](../adr/0090-access-export-and-erasure.md) People export their own data, and project owners export and erase patients. An erased person's work stays under "Former member".
