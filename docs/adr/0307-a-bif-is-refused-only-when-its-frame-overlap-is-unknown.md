# 0307. A BIF is refused only when its frame overlap is unknown, and a declared zero overlap opens as an exact grid

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-014 (Ventana BIF with frame stitching). Applies decision 101 in `docs/decisions.md` (whether the app refuses a BIF with no frame stitching). Amends [ADR 0164](0164-bif-frames-placed-like-openslide.md) (BIF frames placed like OpenSlide)

## Context

ADR 0164 drew a BIF as a plain grid whenever its sidecar had no stitching, so the tissue in every frame overlap showed twice. The owner chose to refuse such a slide and ask for re-ingest, and asked whether some real BIFs rightly have no stitching. The sidecar's `stitching: null` meant two things: the ingest parser returned nothing both when the overlap was unknown and when the joints declared no overlap at all.

Evidence, from the OpenSlide `main` source of `openslide-vendor-ventana.c` and the public test slides:

- When level 0 has no XMP packet, OpenSlide treats the file as "Ventana TIFF (no AOIs or overlaps)" and draws a simple grid. That is the only grid path it has.
- When the packet is present, OpenSlide needs one scanned area per `ImageInfo` with its `AoiOrigin`, the frame size equal to the TIFF tile size and `TileJointInfo` elements, or it fails ("Missing or inconsistent region metadata", "Couldn't find tile joint info"). It accepts only the directions `RIGHT` and `UP`.
- It weights each joint by its `Confidence` and divides by the total weight with no guard, so an axis whose joints all have zero confidence gives no usable advance.
- `OS-1.bif` has 17209 joints in the directions `RIGHT` and `UP`. 10174 of them have confidence 0 where frames were not joined, and the confident mean overlap is about 113 by 109 pixels. Its even pitch reproduces OpenSlide's level 0 size of 105813 by 93951 exactly.
- `Ventana-1.bif`, from a Ventana DP 200, is genuine scanner output with 922 joints at confidence 100. Its vertical joints all declare an overlap of 0, and 105 of its horizontal joints declare 24. It uses the direction `LEFT`, so OpenSlide refuses it and ingest refuses it as unreadable before any stitching is read. Its sidecar was never null for want of joints, which corrects the 2026-11-14 result.

So a real file can lack overlaps in two ways that are correct as a grid, no packet at all and joints that declare zero, and in several ways where nobody can know where the frames go.

## Options considered

1. Refuse every BIF without positive overlap. It would refuse Ventana TIFF files and declared-zero layouts that OpenSlide draws correctly.
2. Keep drawing anything unplaced as a plain grid. The tissue repeats whenever the overlap was really unknown or the sidecar was lost.
3. Decide once at ingest whether the overlap is known, write the placement for every accepted BIF, including an exact grid as a stitching object with an advance equal to the frame size, and let the viewer refuse anything without one.

## Decision

Option 3. `frame_placement` in `workers/ingest/src/parfocal_ingest/bif_frames.py` is the one rule. A level 0 with no XMP packet is a plain grid of its tiles. A packet gives a layout when it has one scanned area whose frame size matches the tiles and confident joints on every axis with more than one frame, and a zero mean overlap there is an exact grid. Anything else is unknown, and so is a placement whose extent is more than one pixel from OpenSlide's level 0 size. Ingest applies the rule in `tiff_pyramid` and refuses an unknown overlap as unreadable, and writes the same placement into `tile-index.json`. The viewer does no stitching arithmetic of its own to decide. `signedOpenRequest` throws `SlideNeedsReingestError` for a BIF whose sidecar is missing or holds no valid stitching, and the app shows "This slide needs re-ingest". A stitching whose advance equals the frame size is read as the stored grid without resampling.

## Consequences

- No slide shows repeated tissue through the app, and no BIF that OpenSlide draws correctly is turned away.
- Sidecars written before this change with `stitching: null` now ask for re-ingest, even when the grid was right. Production holds only test data, so re-ingesting is the remedy.
- The `OS-1.bif` sidecar is unchanged, so the goldens and the reader check stand.
- Tests that open a BIF with no index, such as the plain grid controls in `bif.test.ts` and `viv-bif.spec.ts`, go straight to the registry and still draw the grid on purpose.
- `LEFT` and `DOWN` joints stay out of scope while OpenSlide refuses them. Its open pull requests for DP 200 support would change this, and the rule then needs a DP 200 reference.
