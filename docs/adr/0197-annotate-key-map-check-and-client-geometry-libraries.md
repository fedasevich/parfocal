# 0197. The Annotate key map stays as the kit has it, and the client does geometry with Clipper2, earcut through math.gl, flatbush and a small planar module of its own

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas (accepted 2026-11-04, M stays only for the count marker and every key can be rebound in CMD-006)
- Backlog: ANN-000 (research check). Touches ANN-002 (annotate rail), ANN-006 (freehand), ANN-010 (brush), ANN-016 (grouping rules), ANN-018 (hit testing at scale) and ANN-023 (GeoJSON import).

## Context

ANN-000 asks two things before the Annotate tools are built. First, does the kit key map (the Tools group in `apps/web/src/screens/settings/keymap.ts` and the CTX table of the mock) still match what researchers and pathologists know from QuPath, CVAT, Figma and the SAM extension for QuPath. Second, which geometry library the client uses for clipping, triangulation, simplification and hit testing.

Shapes live in level-0 pixel coordinates as `Float32Array` rings ([ADR 0076](0076-annotation-and-ai-result-storage.md), ANN-001). Overlays are drawn by deck.gl with earcut run once per batch through `@math.gl/polygon` ([ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md)). The rules for this check forbid adding dependencies, so this record only chooses. Each library is added by the task that first needs it.

## What the tools do today

Checked on 2026-11-03. QuPath from its shortcut reference in the `qupath/qupath-docs` repository and its annotating guide, Figma from its help centre and cheat sheets, CVAT from the default sequences in `cvat-ui` source on GitHub, the SAM extension from the `ksugar/qupath-extension-sam` README (v0.9.1). The rendered docs sites of QuPath and CVAT were not reachable from this session, so their GitHub sources were read instead.

| Kit tool | Kit key | QuPath | Figma | CVAT | Reading |
| --- | --- | --- | --- | --- | --- |
| Select | V | M is move, V is polyline | V move | none | Figma wins. QuPath users lose nothing harmful, V never draws |
| Hand | H, Space held | Space held moves, H toggles detections | H, Space held | none | Agrees with Figma and QuPath on Space |
| Smart select (AI) | S, click adds, ⇧click adds, right-click removes, Enter accepts | SAM extension: rectangle or point prompts, background points by class, no keys | none | Interactors: left click positive, right click negative, N finishes | Agrees with CVAT. Enter is a better finish than N, which is No in review |
| Auto region (AI) | U | W is the wand | none | none | No shared convention, keep |
| Polygon | P | P | P is the pen | N starts any draw mode | Agrees with QuPath |
| Freehand | ⇧P | none, polygon drag draws freehand | ⇧P pencil | none | Agrees with Figma |
| Rectangle, Ellipse | R, O | R, O | R, O | none | All agree |
| Count marker | M | `.` is points, M is move | none | M is merge | A QuPath user pressing M gets markers, not move. Clicks are undoable, keep M |
| Ruler | L | L is line | L line | none | Agrees |
| Arrow | ⇧L | none | ⇧L arrow | none | Agrees with Figma. Compare reuses ⇧L, already noted in the key map |
| Text, Comment | T, C | none | T, C | none | Agrees with Figma |
| Brush | B, ⇧ erases | B, Alt erases | none | brush tools in mask mode | B agrees. Erase modifier differs, see the decision |
| Overlays, Fill | A, F | A shows annotations, F fills detections, ⇧F fills annotations | none | none | Agrees with QuPath |

## Options considered

For the key map:

1. Keep the kit key map as it is. It already follows Figma for tools and QuPath for drawing letters and overlays, and the one real clash (M) costs an undo.
2. Switch to QuPath letters throughout (M move, V polyline, `.` points). This breaks the Figma pairs the kit is built on and moves Select off V, the most used key.

For geometry:

| Need | Candidates | Reading |
| --- | --- | --- |
| Boolean union, difference, intersection, offset (brush strokes, merge, cut holes, ANN-016 containment, QuPath GeoJSON with holes) | Clipper2 through `clipper2-ts` (BSL-1.0, 2.0.1-18 from 2026-07-04), `clipper2-js` (last release 2024-01-01), `polyclip-ts` (0.16.8 from 2024-12-17, pulls `bignumber.js`), `@turf/turf` 7.4.0 (boolean ops through `polyclip-ts`) | Clipper2 is the only one with offsetting built in and is the reference for robust integer clipping. `clipper2-ts` is maintained, `clipper2-js` is not |
| Triangulation for fills | `earcut` 3.2.4, `@math.gl/polygon` 4.1.0 (earcut inside, already in the lockfile) | Keep math.gl as ADR 0108 chose, holes go in as hole indices |
| Spatial index for hit testing | `flatbush` 4.7.0 (typed arrays, static), `rbush` (dynamic, object based) | Flatbush fits columnar runs and rebuilds fast. Edited shapes are few enough to rebuild on commit |
| Simplification, area, length, point in polygon | `simplify-js` (last release 2022), turf, own code | Own planar functions, about a page each, tested in the tasks that use them |

Turf was rejected as a whole. Its measures (area, length, distance) are geodesic on WGS84, which is wrong for pixel coordinates, and every call wraps rings in GeoJSON objects, which is slow on the typed arrays ANN-001 stores.

## Decision

The kit key map stays as it is. Two refinements follow from the comparison. The brush also erases with ⌥ held, as in QuPath, besides ⇧ as the mock shows, because the brush has no other use for ⌥. Hold Space pans in any tool, which the mock CTX table already says and the key map lacks, so ANN-002 lists it. QuPath's `.` for points is not added as a second key for the count marker, because the key map gives each action one key and M clashes only with a harmless undoable click.

The client uses Clipper2 through `clipper2-ts` for every boolean and offset operation, converting level-0 coordinates at the boundary to Clipper2's integer or double paths with a fixed scale of at least two decimal places. It keeps earcut through `@math.gl/polygon` for triangulation, uses `flatbush` for the spatial index of ANN-018 unless that task's 1 ms perf test fails, and writes planar area, length, point in polygon and Ramer Douglas Peucker simplification itself. No library is added now. ANN-010 or ANN-016, whichever comes first, adds `clipper2-ts` at an exact version, and ANN-018 adds `flatbush`.

## Consequences

ANN-002 lists hold Space as a temporary hand. ANN-010 names ⌥ as a second erase modifier. ANN-006, ANN-016, ANN-018 and ANN-023 point to this record for their libraries. Clipper2 is large (about 2 MB unpacked), so the task that adds it loads it lazily with the Annotate workspace, and the bundle size check of that task shows the cost. The `clipper2-ts` version names follow upstream Clipper2 with a port suffix, so pin it to an exact version. If a QuPath user study later shows M for markers confuses people, revisit with option 2 for that key only.
