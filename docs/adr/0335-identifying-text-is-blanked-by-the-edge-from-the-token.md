# 0335. Identifying text and barcodes in an original are blanked by the edge from ranges in the token

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SEC-028 (identifying text in de-identified originals). Builds on [ADR 0137](0137-capability-tokens-for-slide-bytes.md) (capability tokens for slide bytes) and [ADR 0333](0333-de-identified-projects-keep-no-labels-and-copies-get-pseudonyms.md) (de-identified projects keep no labels)

## Context

A slide file's own text tags can name the patient or the case: the `Filename` and `User` fields of an SVS ImageDescription, Philips DICOM attributes, the Leica SCN header with its `<barcode>`, the NDPI reference tag. The owner chose on 2026-11-02 (decisions 16a and 17a) that the stored original keeps its bytes and SHA-256, and that the slide byte route serves those ranges as spaces of the same length: identifying text in a de-identified project, barcodes for every reader who may not see labels. A copy keeps the source's bytes, so the choice must come from the reading slide's project at read time. Slide labels in a de-identified project also came from upload file names, which can hold a patient name or accession number.

## Options considered

### Which fields close

1. Allow list per format: blank every SVS field except known technical keys (`AppMag`, `MPP`, `StripeWidth` and similar). Safe when a scanner adds a new free text field.
2. Deny list of known identifying keys. Keeps more text, but a new field leaks.

### Where blanking happens

1. In the edge Worker, from a `b` claim of blank ranges in the token, after the range cache. The cache keeps the original bytes and a reader's rights decide the response.
2. A blanked copy of the original per mode. Doubles storage and breaks the single SHA-256.

### Slide labels in a de-identified project

1. Keep the file name as the label. Simple, but every screen and export shows it.
2. A neutral label `Slide`, numbered `Slide (2)` within its case, with the upload's file name kept only as the internal key result pairing matches on.

## Decision

Option 1 in each case, and option 2 for labels.

| Concern | Rule |
|---|---|
| Ingest | `identifying_text` reads every IFD's text tags. SVS: values of every field outside the technical allow list. Leica SCN: `<barcode>` as barcode, `name` attributes, `<creationDate>` and `<description>` as identifying. Philips: `PIM_DP_UFS_BARCODE` as barcode, attributes naming a patient, accession, study, physician, operator, institution, description, date or time as identifying. OME: image names, descriptions and experimenter fields. Ventana XMP `Barcode` attributes and the NDPI reference tag as barcode. `DocumentName`, `PageName` and `Artist` as identifying |
| Ranges file | `restricted-ranges.json` holds `ranges`, `identifying` and `barcode`. A file without the two new lists closes the whole original whenever the reader needs blanking, so slides ingested before this change fail closed |
| Token | `getTileAccess` adds `b`, the ranges to blank: identifying text when the project is not clinical, barcodes when the reader may not see labels (`sees_restricted`). Absent when empty |
| Edge | A GET of the original pipes the body through a transform that writes 0x20 over the `b` ranges it touches, with the same length, and an ETag ending in `-blank` |
| Labels | Publish into a de-identified project names the slide `Slide`. A switch to de-identified renames every slide of the project and records `slide_labels_replaced` in its audit entry. `pairResultFiles` matches existing slides of a de-identified project on the upload's file name and returns only slide ids |

## Consequences

- The viewer opens a blanked file as before, since lengths, offsets and the technical fields stay. Tests cover SVS, SCN, Philips, NDPI and plain tags with synthetic files.
- DICOM and zip archives stay closed whole, so their attributes never reach the edge.
- After deploying, the shared sample files and any slide already ingested need their ranges file written again, or their originals stay closed. Rewriting a JSON file in the slide bucket is an additive production write.
- Text in an unrecognised ImageDescription stays. TODO: a generic TIFF whose description holds free text needs a rule once a scanner shows one.
- Upload rows keep the file name for the uploader's own progress list and for pairing.
