# Result: BIFs with several scan areas are normal scanner output, and one of the two public BIFs OpenSlide opens has them

- Date: 2026-11-14
- Backlog: VIEW-069 (Ventana BIF with several scan areas)
- Kind: spike
- Commit: 9df315d0
- Environment: MacBook, macOS 15 arm64, Python 3 standard library, HTTP range reads from the OpenSlide test data server
- Data: the public OpenSlide test slides `OS-1.bif`, `OS-2.bif` and `Ventana-1.bif` (only their TIFF directories and level 0 XMP packets were read, a few hundred kilobytes each). No PHI

## Question

How common are Ventana BIFs with several scan areas (AOIs, areas of interest) in Roche DP 200, DP 600 and iScan output, what does OpenSlide do with them, and should Parfocal build their placement now or keep refusing them with a clear message?

## Method

1. Read the Roche BIF whitepaper, version 1.0 ([PDF](https://diagnostics.roche.com/content/dam/diagnostics/Blueprint/en/pdf/rmd/Roche-Digital-Pathology-BIF-Whitepaper.pdf)), as text with `pdftotext -layout`.
2. Read `src/openslide-vendor-ventana.c` on OpenSlide `main` ([source](https://github.com/openslide/openslide/blob/main/src/openslide-vendor-ventana.c)), the functions `parse_level0_xml` and `create_bif_grid`.
3. Read the OpenSlide Ventana format page ([openslide.org/formats/ventana](https://openslide.org/formats/ventana/)), the test data index ([index.yaml](https://openslide.cs.cmu.edu/download/openslide-testdata/Ventana/index.yaml)) and the OpenSlide issues that mention Ventana.
4. Read the level 0 XMP packet of each public test slide with a small range-read script (BigTIFF directory walk, tag 700), and listed every `ImageInfo` and `AoiOrigin` child.
5. Searched the web for public BIF datasets.

## Results

### What the format says

- Roche: "The user can define multiple non-overlapping AOIs", and AOIs "are proposed by the scanner software based on the perceived presence of tissue". All AOIs are merged into one rectangular image approximating their convex hull, unscanned tiles are stored with zero length and are shown in the `ScanWhitePoint` colour. Each AOI has one `ImageInfo` with its own `TileJointInfo` joints, and `AoiOrigin` gives its top left stored tile.
- The whitepaper covers only the DP family (it names the DP 200), and says files from the iScan Coreo and iScan HT "cannot be reconstructed correctly based on the information included in this document and should not be attempted". Its example joints use the direction `LEFT`, and it says DP 200 files have no vertical overlap.
- Roche's other pages say the published specification covers the DP 200 and DP 600. Not checked against a DP 600 file. TODO, a DP 600 sample would settle it.

### What OpenSlide does

- It pairs the i-th `ImageInfo` with the i-th `AoiOrigin` child and fails with "Missing or inconsistent region metadata" when the counts differ. It skips an area with `AOIScanned="0"`.
- Each scanned area must have the TIFF tile size, an origin that is a multiple of it and at least one column and row. The area's first stored tile is its origin divided by the tile size.
- One confidence-weighted overlap per direction is averaged over the joints of all areas, which gives a single advance across and down for the whole slide.
- The area's `Pos-X` is its left edge in level 0 pixels. `Pos-Y` is measured upwards from below all areas to the area's bottom, and is flipped: `top = max(Pos-Y + height)` over the areas, then `y = top - Pos-Y - height`, all in 64-bit integers. The height is `(rows - 1) * advanceY + tileHeight`.
- Every stored tile of an area is placed at `x + (column - firstColumn) * advanceX`, and the same down. The level size is the far edge of all placed tiles. No check stops areas from overlapping or from running past the stored grid.
- `LEFT` and `DOWN` joints fail with "Bad direction attribute". That is [issue 234](https://github.com/openslide/openslide/issues/234) (open since 2018, users of DP 200 files) and [issue 759](https://github.com/openslide/openslide/issues/759) (open, June 2026). Placing areas by `Pos-X` and `Pos-Y` came from [issue 127](https://github.com/openslide/openslide/issues/127) (Ventana AOIs not properly placed, closed 2015), whose author found that "The leftmost AOI always has a Pos-X of 0, but the bottommost AOI has an arbitrary positive Pos-Y".

### The public slides

| Slide | Scanner or note | Joint direction | `ImageInfo` | Scanned | Opens in OpenSlide | Opens in Parfocal |
|---|---|---|---|---|---|---|
| `OS-1.bif` | older iScan | `RIGHT` | 1 | 1 | yes | yes |
| `OS-2.bif` | older iScan, Ki-67 | `RIGHT` | 3 | 2 | yes | no, refused as unreadable |
| `Ventana-1.bif` | DP 200 | `LEFT` and `UP` | 1 | 1 | no | no, refused as unreadable |

The joint directions of `OS-1.bif` and `OS-2.bif` come from the test data index, because the script's pattern did not match their packets. `Ventana-1.bif` has one area of 23 x 21 frames of 1024 x 1024 with `Pos-X` 25165, so OpenSlide's placement would start it 25165 pixels from the left edge if it accepted `LEFT` joints.

`OS-2.bif` level 0 is 128000 pixels wide with frames of 1024 x 1360:

| Area | `AOIScanned` | Columns x rows | `Pos-X` | `Pos-Y` | `OriginX`, `OriginY` |
|---|---|---|---|---|---|
| 0 | 1 | 11 x 17 | 0 | 49268 | 0, 38080 |
| 1 | 0 | 12 x 10 | 5473 | 30559 | 6144, 68000 |
| 2 | 1 | 95 x 61 | 28274 | 25569 | 30720, 0 |

The placed positions and the OpenSlide level size of `OS-2.bif` were not computed. TODO: they need its joints, which one full XMP read gives.

### Datasets and reports

- The web search found no public dataset of BIF files beyond the OpenSlide test data. TCIA pathology collections and the other datasets found use other formats.
- The OpenSlide issues about BIF are about `LEFT` joints from DP 200 files and about tile alignment ([issue 132](https://github.com/openslide/openslide/issues/132), open since 2014). None reports a wrong placement of several areas since 2015.

## Interpretation

- Several scan areas are not a corner case. The scanner proposes one AOI per tissue region, so any slide with separate tissue pieces, such as several biopsy cores, is likely to have them. One of the two public BIFs that OpenSlide opens has three areas, one of them skipped. There is no count across real archives, so how often is an assumption from the format, not a measurement.
- For the current DP 200 and DP 600 scanners the question is moot today. Their files use `LEFT` joints, which OpenSlide and Parfocal both refuse before any area is placed, whatever the number of areas.
- So placing several areas helps only older iScan files with `RIGHT` joints, which Roche itself says cannot be rebuilt correctly from the metadata. OpenSlide rebuilds them anyway, and `OS-2.bif` is a real reference for that.
- Parfocal refuses such a file as "unreadable", which tells the user nothing. The existing `multi-region` refusal names Leica files in its message, so it cannot be reused as it is.

## Follow-ups

- Recommendation: keep the refusal for now, and give it its own clear message that the slide holds several scan areas and is not supported yet, because the scanners in use today write `LEFT` joints that are refused first, and the files that would benefit are older iScan scans. Build the placement together with `LEFT` and `DOWN` support for the DP family, use `OS-2.bif` as the OpenSlide reference rather than only a synthetic file, and use a DP 200 or DP 600 file with several areas once one is found.
- TODO for the owner: whether older iScan archives matter to the first users. If they do, the placement can be built now against `OS-2.bif` with the arithmetic above.
- No code was changed for VIEW-069.
