# Result: server slide reading with tifffile, tiffslide, OpenSlide and wsidicom

- Date: 2026-10-15
- Backlog: STACK-026 (slide reading and tiling on the server)
- Kind: spike
- Commit: 4f1be06 (the fixture manifest in `packages/test-fixtures/fixtures.json` at that commit). The spike scripts live outside the repository.
- Environment: MacBook with Apple M4 and 24 GB RAM, macOS 15.8.1 arm64, local SSD, warm page cache. Python 3.14.7 (the backend version) with tifffile 2026.9.20, tiffslide 4.0.0, openslide-python 1.4.6, openslide-bin 4.0.1.2 (libopenslide 4.0.1), imagecodecs 2026.10.10, wsidicom 0.36.1, zarr 3.4.1, numpy 2.5.4. The first pass also ran on Python 3.13.15 and opened the same set of files with the same libraries. No cloud was touched.
- Data: public OpenSlide test files and CAMELYON16 `tumor_009.tif` as listed in the fixture manifest, linked from the POC copy in the fixture cache, plus the two synthetic TIFFs in `packages/test-fixtures/synthetic`. The OpenSlide, CAMELYON16 and synthetic slides carry no PHI. Nothing was downloaded. The three zip files (MRXS and two DICOM sets) were unpacked into a temporary folder outside the repository.

## Question

For each format the POC supports, which Python library opens it on the server, what levels and pixel size does it report, and how long does a 512 px region take. STACK-026 asks for an ADR that names one reader and one fixture per format. The POC has no server-side number for this. Doc 08 measured browser-side reading only.

## Method

1. Created a uv environment per Python version and installed the packages above from PyPI.
2. For each file, tried tifffile, tiffslide and OpenSlide. DICOM sets were also tried with wsidicom. A library "opens" a file when its constructor succeeds and a region read returns pixels.
3. Recorded levels, level 0 size and pixel size as reported by the library. For tifffile the levels are those of the largest series, and it reports no pixel size.
4. Picked a tissue point per library by splitting a thumbnail into a 24 by 24 grid and choosing the cell with the highest mean per-channel standard deviation. Read a 512 by 512 region at level 0 from that point five times. "First" is the first read after open. "Median" is the median of reads two to five. Open time is the constructor time. All times are wall-clock milliseconds from `time.perf_counter`.
5. Where tiffslide and OpenSlide read the same origin, compared the RGB channels and recorded the mean absolute difference per channel value (0 to 255).
6. Repeated the first pass in a second environment on Python 3.13.15 and compared which libraries opened which files.
7. Ran the same steps on the larger files in the POC folder, read in place and read only (`OS-1.bif`, `Hamamatsu-1.ndpi`, `OS-1.ndpi`, `Leica-3.scn`, `Philips-3.tiff`, `CMU-2.svs`, `JP2K-33003-2.svs`, `Argos-1-Stacked.avs`).

## Results

### Fixtures in the manifest, Python 3.14.7

A blank cell in the Levels column means the library did not open the file. The MRXS and DICOMDIR rows list the size of the index file only.

| Fixture | File | MB | Library | Opens | Levels | Level 0 | mpp | Open ms | 512 first ms | 512 median ms | Non-blank |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Aperio SVS JPEG | CMU-1.svs | 177.6 | tifffile | yes | 3 | 46000x32914 | n/a | 1.3 | 3.2 | 1.7 | yes |
| Aperio SVS JPEG | CMU-1.svs | 177.6 | tiffslide | yes | 3 | 46000x32914 | 0.499 | 0.6 | 2.1 | 1.9 | yes |
| Aperio SVS JPEG | CMU-1.svs | 177.6 | openslide | yes | 3 | 46000x32914 | 0.499 | 4.9 | 5.1 | 3.3 | yes |
| Aperio SVS one level | CMU-1-Small-Region.svs | 1.9 | tifffile | yes | 1 | 2220x2967 | n/a | 0.6 | 1.7 | 1.2 | yes |
| Aperio SVS one level | CMU-1-Small-Region.svs | 1.9 | tiffslide | yes | 1 | 2220x2967 | 0.499 | 0.3 | 2.1 | 1.8 | yes |
| Aperio SVS one level | CMU-1-Small-Region.svs | 1.9 | openslide | yes | 1 | 2220x2967 | 0.499 | 3.6 | 3.5 | 3.4 | yes |
| Aperio SVS JP2K 33003 | JP2K-33003-1.svs | 63.8 | tifffile | yes | 3 | 15374x17497 | n/a | 1.7 | 5.7 | 4.2 | yes |
| Aperio SVS JP2K 33003 | JP2K-33003-1.svs | 63.8 | tiffslide | yes | 3 | 15374x17497 | 0.2498 | 0.3 | 5.1 | 4.7 | yes |
| Aperio SVS JP2K 33003 | JP2K-33003-1.svs | 63.8 | openslide | yes | 3 | 15374x17497 | 0.2498 | 2.2 | 20.2 | 3.2 | yes |
| Aperio SVS JP2K 33005 | CMU-1-JP2K-33005.svs | 132.6 | tifffile | yes | 3 | 46000x32893 | n/a | 1.5 | 5.8 | 4.4 | yes |
| Aperio SVS JP2K 33005 | CMU-1-JP2K-33005.svs | 132.6 | tiffslide | yes | 3 | 46000x32893 | 0.499 | 0.6 | 6.4 | 5.0 | yes |
| Aperio SVS JP2K 33005 | CMU-1-JP2K-33005.svs | 132.6 | openslide | yes | 3 | 46000x32893 | 0.499 | 2.4 | 18.4 | 3.3 | yes |
| Generic pyramidal TIFF | CMU-1.tiff | 204.1 | tifffile | yes | 9 | 46000x32914 | n/a | 1.4 | 2.0 | 1.1 | yes |
| Generic pyramidal TIFF | CMU-1.tiff | 204.1 | tiffslide | yes | 9 | 46000x32914 | 1000 | 0.7 | 2.2 | 1.9 | yes |
| Generic pyramidal TIFF | CMU-1.tiff | 204.1 | openslide | yes | 9 | 46000x32914 | 1000 | 0.5 | 4.9 | 3.3 | yes |
| CAMELYON16 BigTIFF | tumor_009.tif | 2466.3 | tifffile | yes | 10 | 97792x217088 | n/a | 3.7 | 1.9 | 1.2 | yes |
| CAMELYON16 BigTIFF | tumor_009.tif | 2466.3 | tiffslide | yes | 10 | 97792x217088 | 0.2431 | 1.9 | 2.6 | 1.7 | yes |
| CAMELYON16 BigTIFF | tumor_009.tif | 2466.3 | openslide | yes | 10 | 97792x217088 | 0.2431 | 5.9 | 6.3 | 3.3 | yes |
| Hamamatsu NDPI | CMU-1.ndpi | 198.0 | tifffile | yes | 4 | 51200x38144 | n/a | 3.7 | 7.9 | 5.4 | yes |
| Hamamatsu NDPI | CMU-1.ndpi | 198.0 | tiffslide | yes | 4 | 51200x38144 | 0.4564 | 3.0 | 7.1 | 6.3 | yes |
| Hamamatsu NDPI | CMU-1.ndpi | 198.0 | openslide | yes | 9 | 51200x38144 | 0.4564 | 0.8 | 6.2 | 0.7 | yes |
| Ventana BIF | Ventana-1.bif | 227.4 | tifffile | yes | 8 | 24576x21504 | n/a | 0.6 | 4.9 | 3.0 | yes |
| Ventana BIF | Ventana-1.bif | 227.4 | tiffslide | yes | 8 | 24576x21504 | 0.25 | 0.3 | 7.8 | 6.3 | yes |
| Ventana BIF | Ventana-1.bif | 227.4 | openslide | no | | | | | | | Bad direction attribute "LEFT" |
| Leica SCN | Leica-1.scn | 291.8 | tifffile | yes | 5 | 36832x38432 | n/a | 0.4 | 2.6 | 1.9 | yes |
| Leica SCN | Leica-1.scn | 291.8 | tiffslide | yes | 5 | 53130x153470 | 0.5 | 0.3 | 2.2 | 2.2 | yes |
| Leica SCN | Leica-1.scn | 291.8 | openslide | yes | 5 | 53130x153470 | 0.5 | 0.5 | 6.4 | 3.4 | yes |
| Philips TIFF | Philips-4.tiff | 291.0 | tifffile | yes | 9 | 91136x68096 | n/a | 2.3 | 1.7 | 1.3 | yes |
| Philips TIFF | Philips-4.tiff | 291.0 | tiffslide | yes | 9 | 91136x68096 | 0.25 | 0.5 | 2.1 | 1.9 | yes |
| Philips TIFF | Philips-4.tiff | 291.0 | openslide | yes | 9 | 91136x68096 | 0.25 | 0.9 | 5.4 | 3.2 | yes |
| Huron TIFF JPEG | Huron-1-40x.tif | 115.7 | tifffile | yes | 3 | 12040x21006 | n/a | 0.7 | 2.3 | 1.4 | yes |
| Huron TIFF JPEG | Huron-1-40x.tif | 115.7 | tiffslide | yes | 3 | 12040x21006 | 0.2 | 0.3 | 2.3 | 1.7 | yes |
| Huron TIFF JPEG | Huron-1-40x.tif | 115.7 | openslide | yes | 3 | 12040x21006 | 0.2 | 1.4 | 5.6 | 3.2 | yes |
| Huron TIFF uncompressed | Huron-1-Uncompressed.tif | 213.7 | tifffile | yes | 3 | 6022x10503 | n/a | 0.7 | 3.5 | 0.7 | yes |
| Huron TIFF uncompressed | Huron-1-Uncompressed.tif | 213.7 | tiffslide | yes | 3 | 6022x10503 | 0.4 | 0.3 | 1.8 | 1.1 | yes |
| Huron TIFF uncompressed | Huron-1-Uncompressed.tif | 213.7 | openslide | yes | 3 | 6022x10503 | 0.4 | 2.6 | 4.1 | 3.3 | yes |
| ARGOS AVS | Argos-1.avs | 93.5 | tifffile | yes | 8 | 130546x57440 | n/a | 0.4 | 2.0 | 1.3 | yes |
| ARGOS AVS | Argos-1.avs | 93.5 | tiffslide | yes | 8 | 130546x57440 | 0.383 | 0.4 | 1.1 | 1.0 | no, see notes |
| ARGOS AVS | Argos-1.avs | 93.5 | openslide | yes | 8 | 130546x57440 | 0.383 | 0.6 | 5.7 | 3.2 | yes |
| MIRAX MRXS | CMU-1-Saved-1_16.mrxs | 0.0 | tifffile | no | | | | | | | not a TIFF file |
| MIRAX MRXS | CMU-1-Saved-1_16.mrxs | 0.0 | tiffslide | no | | | | | | | not a TIFF file |
| MIRAX MRXS | CMU-1-Saved-1_16.mrxs | 0.0 | openslide | yes | 6 | 7436x15494 | 3.7172 | 2.8 | 8.9 | 4.4 | yes |
| DICOM WSI (Aperio JP2K) | DCM_0.dcm | 121.9 | tifffile | yes, see notes | 1 | 46000x32893 | n/a | 0.7 | 42.5 | 4.3 | yes |
| DICOM WSI (Aperio JP2K) | DCM_0.dcm | 121.9 | tiffslide | yes, see notes | 1 | 46000x32893 | 0.499 | 7.7 | 6.2 | 5.4 | yes |
| DICOM WSI (Aperio JP2K) | DCM_0.dcm | 121.9 | openslide | yes | 3 | 46000x32893 | 0.499 | 2.1 | 30.0 | 3.3 | yes |
| DICOM WSI (Aperio JP2K) | DCM_0.dcm | 121.9 | wsidicom | yes | 3 | 46000x32893 | 0.499 | 13.4 | 18.4 | 0.4 | yes |
| DICOM WSI (Leica) | DICOMDIR | 0.0 | tifffile | no | | | | | | | not a TIFF file |
| DICOM WSI (Leica) | DICOMDIR | 0.0 | tiffslide | no | | | | | | | not a TIFF file |
| DICOM WSI (Leica) | DICOMDIR | 0.0 | openslide | no | | | | | | | Unsupported or missing image file |
| DICOM WSI (Leica) | DICOMDIR | 0.0 | wsidicom | yes | 3 | 23374x22079 | 1.0511 | 7.4 | 26.9 | 0.4 | yes |
| DICOM WSI (Leica), volume file | 1.3.6.1.4.1.36533.2177...7166.dcm | 68.2 | openslide | yes | 3 | 23374x22079 | 1.0511 | 40.2 | 4.2 | 3.2 | yes |
| Zeiss CZI | Zeiss-5-Flat.czi | 52.3 | tifffile | no | | | | | | | not a TIFF file |
| Zeiss CZI | Zeiss-5-Flat.czi | 52.3 | tiffslide | no | | | | | | | not a TIFF file |
| Zeiss CZI | Zeiss-5-Flat.czi | 52.3 | openslide | no | | | | | | | JPEG XR compression is not supported |
| OME-TIFF (synthetic) | synthetic-zlib.ome.tiff | 0.04 | tifffile | yes | 3 | 1024x768 | n/a | 0.3 | 0.9 | 0.8 | yes |
| OME-TIFF (synthetic) | synthetic-zlib.ome.tiff | 0.04 | tiffslide | yes | 3 | 1024x768 | 0.5 | 0.3 | 1.4 | 1.1 | yes |
| OME-TIFF (synthetic) | synthetic-zlib.ome.tiff | 0.04 | openslide | yes | 1 | 1024x768 | 0.5 | 0.2 | 3.4 | 3.3 | yes |
| Plain TIFF (synthetic) | synthetic-jpeg.tiff | 0.09 | tifffile | yes | 3 | 1024x768 | n/a | 1.0 | 1.0 | 0.7 | yes |
| Plain TIFF (synthetic) | synthetic-jpeg.tiff | 0.09 | tiffslide | yes | 3 | 1024x768 | 0.5 | 0.2 | 1.4 | 1.1 | yes |
| Plain TIFF (synthetic) | synthetic-jpeg.tiff | 0.09 | openslide | yes | 3 | 1024x768 | 0.5 | 0.2 | 3.4 | 3.3 | yes |

### Larger files read in place from the POC folder, Python 3.14.7

Each row is level count, level 0 size, mpp, open ms, first and median 512 px read in ms. Mean absolute difference is between tiffslide and OpenSlide on the same origin, when both opened.

| File | MB | tifffile | tiffslide | openslide | Mean abs diff |
|---|---|---|---|---|---|
| OS-1.bif | 3871 | 10, 118784x102000, n/a, 0.6, 5.8, 4.5 | 10, 118784x102000, none, 0.3, 6.0, 4.9 | 10, 105813x93951, 0.2325, 29.7, 27.5, 10.2 | not comparable |
| Hamamatsu-1.ndpi | 6901 | 6, 188160x101376, n/a, 18.8, 20.2, 12.4 | 6, 188160x101376, 0.2303, 16.1, 14.4, 12.8 | 9, 188160x101376, 0.2303, 3.9, 19.7, 0.7 | 0.0 |
| OS-1.ndpi | 1992 | 10, 122880x110592, n/a, 10.8, 7.8, 6.3 | 10, 122880x110592, 0.2271, 11.5, 6.6, 6.2 | 13, 122880x110592, 0.2271, 2.1, 6.6, 0.6 | 0.0 |
| Leica-3.scn | 2994 | 6, 38848x26496, n/a, 0.7, 3.1, 1.8 | fails: non-macro images vary too much in resolution | fails: Slides with dissimilar main images are not supported | not comparable |
| Philips-3.tiff | 3305 | 9, 131072x100352, n/a, 2.0, 2.1, 1.5 | 9, 131072x100352, 0.2269, 1.0, 2.4, 1.9 | 9, 131072x100352, 0.2269, 1.4, 6.3, 3.4 | 0.0 |
| CMU-2.svs | 391 | 4, 78000x30462, n/a, 2.0, 2.2, 1.2 | 4, 78000x30462, 0.499, 0.8, 2.3, 1.7 | 4, 78000x30462, 0.499, 3.5, 4.8, 3.3 | 0.0 |
| JP2K-33003-2.svs | 289 | 3, 32671x47076, n/a, 1.2, 6.6, 4.9 | 3, 32671x47076, 0.2498, 0.6, 7.1, 5.1 | 3, 32671x47076, 0.2498, 2.4, 21.7, 3.4 | 0.442 |
| Argos-1-Stacked.avs | 460 | 1, 3180x1399, n/a, 0.9, 2.6, 2.1 | fails: no support for series.ndim not in (2, 3) | 8, 130546x57440, 0.383, 3.0, 7.1, 3.3 | not comparable |


### Pixel agreement between tiffslide and OpenSlide

Mean absolute difference per RGB channel value on the same 512 px region. Rows not listed had no common origin or one library did not open the file.

| Fixture | Mean abs diff |
|---|---|
| CMU-1.svs, CMU-1-Small-Region.svs, CMU-1-JP2K-33005.svs, CMU-1.tiff, tumor_009.tif, CMU-1.ndpi, Philips-4.tiff, Huron-1-40x.tif, Huron-1-Uncompressed.tif, DCM_0.dcm, both synthetic TIFFs | 0.0 |
| JP2K-33003-1.svs | 0.447 |
| JP2K-33003-2.svs | 0.442 |
| Argos-1.avs at the OpenSlide origin (67736, 27267) | 0.0 |
| Leica-1.scn at (34057, 60492) and (16347, 34914) | 0.0 |

### Notes on single results

- The ARGOS tiffslide row reads blank because its own tissue pick landed on a sparse area. Reading the OpenSlide origin gave standard deviation 51.1 in both libraries and difference 0.0.
- `DCM_0.dcm` has a BigTIFF header (`II+`) and is also a valid DICOM file. tifffile and tiffslide open it as a TIFF and see one level. It is a hybrid file, so the TIFF rows say nothing about DICOM reading.
- `CMU-1.tiff` reports mpp 1000 in both libraries. The file has no usable pixel size and the value is a unit mistake in the resolution tags. It must not be trusted.
- OpenSlide reports more levels than tifffile and tiffslide for NDPI (9 against 4, 13 against 10), because it adds levels it derives itself.
- OpenSlide sees one level in the synthetic OME-TIFF where tifffile and tiffslide see three.
- `Ventana-1.bif` opens in tifffile and tiffslide without BIF handling. tiffslide printed "no special ventana-format metadata parsing implemented yet" and tifffile printed "BIF series tiles are not stitched". The mpp of 0.25 comes from tiffslide, not from BIF metadata, and the size differs from what OpenSlide reports for `OS-1.bif`, so the pixels are not proven correct.
- The unpacked DICOM Aperio set has six instances (volume, resampled volumes, thumbnail, label, overview). The Leica set has six instances plus a DICOMDIR.

## Interpretation

These are facts of this run, with the labelled assumptions below.

- OpenSlide 4.0.1 opened every format in the POC list that it supports except `Ventana-1.bif`, and it is the only library here that opened MRXS. It also read the BIF `OS-1.bif`, where tifffile and tiffslide report a different size because they do not stitch.
- tiffslide and OpenSlide agreed to the pixel on every TIFF-family file except the two Aperio JPEG 2000 YCbCr files, which differ by about 0.44 on average. The cause is not investigated. Assumption: the two JPEG 2000 decoders round colour conversion differently.
- tiffslide reads OME-TIFF pyramids where OpenSlide sees one level.
- Region reads were in the low milliseconds for all of them with a warm cache on a local SSD. The differences between libraries are small in this run and do not decide the choice. First reads of JPEG 2000 tiles in OpenSlide were 16 to 30 ms, against 5 to 7 ms in tiffslide.
- The numbers do not predict production. Reads came from a warm local disk and not from R2, and the Apple M4 is not the Modal CPU.
- Reading from object storage is untested. OpenSlide needs a local path, and MRXS needs a folder of files.

## Follow-ups

- [ADR 0043](../adr/0043-server-slide-reading.md) records the reader per format from these numbers.
- TODO: find why `Ventana-1.bif` fails in OpenSlide with `Bad direction attribute "LEFT"` while `OS-1.bif` opens, and decide whether a BIF conversion trigger fires.
- TODO: test reading from R2 by range (tiffslide through fsspec) and the cost of copying a file to Modal ephemeral disk. Needs the cloud, so it waits.
- TODO: run the OME-Zarr reader on `tumor_009.zarr` from the POC. The zarr package is installed but no Zarr store was read in this spike.
- TODO: run TIAToolbox for pixel-size-aware tiling. It pulls PyTorch and was not installed in this spike.
- TODO: find a Philips iSyntax sample and a 3DHISTECH slide with a larger tile count to size the unsupported cases.
- TODO: measure the JPEG 2000 YCbCr difference against a third decoder if colour accuracy matters for review.
