# 0333. A de-identified project stores no label or macro, and a slide copied into one gets a pseudonymous case

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SEC-008 (de-identified projects). Touches SEC-009 (label and macro handling), PROJ-002 (privacy modes) and SEC-028 (identifying text in de-identified originals)

## Context

SEC-008 asks that a de-identified project never holds a direct identifier, whether a slide arrives by upload, link import, an integration or a copy from a clinical project. [ADR 0124](0124-labels-and-macros-only-for-whole-project-readers-in-clinical-projects.md) (labels and macros only for whole-project readers in clinical projects) already refuses the label route in a de-identified project, but ingest still extracted and stored the images. There was no way to copy a slide between projects. The identifying text inside the original file is SEC-028's work.

## Options considered

### Where ingest decides

1. Per entry route. Each of upload, link import and a future webhook would pass a flag, and a new route could forget it.
2. In the ingest workflow, from the project row. Every route creates an upload row and runs the same workflow, so one check covers them all.

### What a switch to de-identified does with stored labels

1. Refuse the switch while a slide holds a label. A project could then never switch, because labels cannot be removed one by one.
2. Delete them in the same request, as patient erasure does ([ADR 0090](0090-access-export-and-erasure.md), access export and erasure).

### How a copied case is named

1. A random pseudonym kept in a mapping table. Stable, but adds a table, its row security and its erasure rules.
2. A keyed hash of the target project and the source case, made with the workspace's blind index key from SEC-004 (field encryption). Stable without storage, and nobody without the key can link it back.

### How a copy holds its files

1. Point at the source slide's folder. Cheap, but deleting the source or a retention purge would break the copy.
2. Copy the public files server side into the new slide's folder. The copy stands alone.

## Decision

Option 2 in each case.

| Concern | Rule |
|---|---|
| Ingest | `derive` reads the project's privacy mode and extracts labels and macros only in a clinical project. `publish` reads it again under `FOR SHARE` on the project row and, if the project is no longer clinical, publishes with no restricted images and deletes any it stored. The lock orders publish against a privacy switch |
| Switch to de-identified | `changeProjectPrivacy` empties `restricted_images` and deletes the stored files of every slide in the project. Its audit entry carries `restricted_images_deleted` |
| Copy route | `POST /api/projects/{project_id}/slide-copies` (`copySlides`) takes 1 to 20 slide ids. The caller owns the target and every source project (`create-cases`). The target must be de-identified (400 `copy-needs-de-identified-project`), a source must be in another project (400 `copy-within-project`) and published (400 `slide-not-ready`) |
| Copied slide | A new slide row with the source's image facts and SHA-256, label `Slide` (numbered when taken), no barcode, no block and no restricted images. The public files are copied, the restricted folder is not |
| Copied case | `Case ` and ten base32 characters from the keyed hash. The same source case copied into the same project always lands in the same case. A new case has source `copy` (migration 0118) |
| Audit | Each copy records `slide.copied` on the new slide with the source slide and both project ids |

## Consequences

- Upload, a service account upload and a link import into a de-identified project are each tested to store no label or macro. There is no webhook receiver yet. One that creates an upload row is covered by the same check.
- A project switched back to clinical shows no labels for slides that arrived while it was de-identified, as the owner chose on 2026-11-02.
- Copying into a clinical project is refused, because it would copy patient data between projects. TODO: the owner decides whether a lab needs it.
- Shredding a workspace's keys changes future pseudonyms, so a later copy of the same case lands in a new case.
- The seam for SEC-028: a copy keeps the original's bytes, so blanking identifying text must be decided from the reading slide's project, where `getTileAccess` already reads `privacy_mode` and the restricted ranges, not from the stored object.
- The slide label still comes from the file name on upload, because result pairing matches on it. The data map classes it as PHI.
