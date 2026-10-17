# 0071. Object IDs are a kind letter and a per-slide number, paths are percent-encoded with `~` for loose slides, and IDs carry across result sets by IoU 0.5 or 4 µm

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval, with the thresholds open for the owner)
- Backlog: OBJ-000 (research check for object IDs), shapes OBJ-001 (grammar and allocation), OBJ-002 (IDs across result sets), OBJ-003 (split, merge and added objects), OBJ-004 (resolution and search), RSET-008 (exports) and PROJ-008 (project settings), and closes the TODO on loose slide paths in [ADR 0062](0062-project-model.md)

## Context

POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) "IDs for objects" and the UX kit page "ID system" set short IDs that a doctor can say out loud, scoped to the slide: T2 for a region, T2·C145 for a cell inside it, C3021 for a cell outside any region, R4 for a region of interest drawn by a person, Z1 for a zone of unsure cells, M1 for a measurement and T6⁺ for an object a reviewer added. Regions are numbered by size, largest first. Links, exports and search use the full path `P07/S26-04812/A1/T2·C145`, and search accepts any part of it. Splitting T2 gives T2a and T2b, and merging T2 and T3 keeps T2 with T3 as an alias. When a new result set arrives, objects that overlap an existing one above a threshold inherit its ID, by IoU for regions and by distance for cells. The kit lists the thresholds per object kind as an open question.

Two facts in this repository shape the grammar. Case labels are free text up to 100 characters and may contain `/` ([ADR 0063](0063-cases-and-slides-in-projects.md)). Loose slides have no case, so a path needs a way to say that without being mistaken for a case label ([ADR 0062](0062-project-model.md)).

## Options considered

### Cell numbers

1. Number cells per region (T2·C1, T2·C2, T3·C1). The numbers are short, but a split or a merge renumbers cells, and the same cell would get a new ID.
2. Number cells once per slide and show the region as context. T2·C145 and C145 name the same cell, and a cell keeps its number when its region is split or merged.

### Path segments

1. Join the parts with `/` as they are. Readable, but a case label with a `/` breaks the path.
2. Percent-encode each segment as URLs do, and write `~` for the case of a loose slide. A case label that is exactly `~` is refused.

### Thresholds

1. Fixed values in code.
2. Project settings with defaults, so a project with unusual objects can tune them without a migration.

## Decision

Option 2 in each case.

| Kind | Letter | Numbered | Notes |
|---|---|---|---|
| AI region of any class | T | Per slide, by area, largest first, at first import | The class shows next to the ID. The letter is T in every taxonomy, as in the kit |
| AI cell | C | Per slide, in reading order of centroids (top to bottom, then left to right, at level 0) | Shown as T2·C145 inside a region and C145 elsewhere. Both resolve to the same cell |
| Region of interest | R | Per slide, in the order people draw them | Always made by a person |
| Unsure zone | Z | Per slide, by area | Built from the cells the AI is unsure about |
| Measurement | M | Per slide, in the order people make them | Ruler or area |

- Counters never go back. A new result set that brings new objects continues the counter, and a deleted object's number is not reused.
- An object a reviewer adds gets the next number and a person mark, written `⁺` on screen and `+` in paths and exports, as in T6⁺ and `T6+`. Parsing accepts both.
- The separator between region and cell is `·` on screen and `.` in ASCII. Parsing accepts both.
- Splitting T2 gives T2a, T2b and so on (then T2aa), and T2 stays in the history. Merging keeps the lower number, which is the larger region at first numbering, and keeps the other as an alias. Source IDs from imported files are kept as aliases too.
- The full path is `{project}/{case}/{slide}/{object}`, for example `P07/S26-04812/A1/T2.C145`, with each segment percent-encoded and `~` as the case of a loose slide, as in `P07/~/tcga-0042/T2`. Any trailing part resolves within the context it is typed in (OBJ-004).
- Matching across result sets is one to one and greedy, best match first. Regions and zones match at IoU of at least 0.5. Cells match when their centroids are at most 4 µm apart, converted with the slide's microns per pixel, or 16 pixels at level 0 when the slide has no calibration. A class change keeps the ID, because the diff view exists to show it. Objects without a match get new numbers, and objects missing from the new set show as "not in this set".
- Both thresholds are project settings (PROJ-008) with these defaults.

Why these defaults: IoU 0.5 is the usual match threshold in object detection benchmarks such as PASCAL VOC and COCO. The 4 µm is an assumption, about half the diameter of a typical nucleus, chosen so that two neighbouring nuclei do not swap IDs. TODO: MLEVAL checks both against reviewer agreement on the first real task, and the owner may change them, because the kit lists them as an open question.

## Consequences

- OBJ-001 stores the kind, the number, the split suffix and the person mark per object, and parses every display, ASCII and path form back. It also refuses `~` as a case label.
- OBJ-002 implements the matching with shapely's STRtree for regions and a KD-tree over centroids for cells. No new matching library is needed.
- Exports (RSET-008) write the ASCII form and the full path, and keep aliases in the properties.
- The ADR 0062 TODO on loose slide paths is closed.
