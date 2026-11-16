# Result: PanNuke and MoNuSeg load from their official archives, and the checksums of all three PanNuke folds match Warwick's ETags

- Date: 2026-11-16
- Backlog: MLEVAL-010 (loaders for datasets behind a sign-in)
- Kind: baseline
- Commit: the MLEVAL-010 commit that adds this file, on top of 74ebacd0
- Environment: Apple M4, 24 GB, macOS 15 (Darwin 24.6), Python 3.14 through uv, numpy, scipy and Pillow. No model runs. Other agents shared the machine
- Data: PanNuke folds 1, 2 and 3 from the Warwick TIA page and the MoNuSeg 2018 training and test zips from the Google Drive links on the challenge's data page, all downloaded on 2026-11-16 without a sign-in into `~/.cache/parfocal/datasets`, 2.24 GB in all. Nothing is committed. Public data, no PHI

## Question

Can PanNuke and MoNuSeg be fetched without an account and pinned by checksum, and do the new loaders give the images and nuclei the published papers and the POC report? Do the CryoNuSeg and Lizard loaders read the layouts their releases use?

## Method

Neither Warwick nor the MoNuSeg page publishes a checksum, so the first download became the reference. For PanNuke the SHA-1 of each zip was compared with the `ETag` header Warwick's server sends, which gives a server-side reference after all. Each archive's size and MD5 are pinned in `parfocal_ml.datasets.REGISTRY`, which now registers one entry per archive: `pannuke-fold1` to `pannuke-fold3`, `monuseg-train` and `monuseg-test`.

The PanNuke loader streams `images.npy` and `masks.npy` (both float64, 4.2 GB and 8.4 GB uncompressed per fold) row by row from inside the zip, so a whole fold loads at a peak of 415 MB of memory. It merges the five class channels into one instance map and keeps each nucleus's class in the new optional `Sample.classes`. The MoNuSeg loader draws each Aperio XML region as a filled polygon. `workers/ml/tests/test_dataset_archives.py` checks every loader on tiny synthetic archives built at test time and repeats the counts below where the archives are cached.

CryoNuSeg and Lizard need a Kaggle sign-in or CoNIC registration, so their loaders read synthetic archives only. Most of each layout comes from a public loader. torch-em's `cryonuseg.py` gives `tissue images/*.tif` and annotator 1's `label masks modify/*.tif`, the same default rater. torch-em's `lizard.py` gives the Kaggle mirror's `Lizard_Images1` and `Lizard_Images2` PNGs, `Lizard_Labels/Labels/*.mat` with `inst_map` and `class`, and `Lizard_Labels/info.csv` with `Filename` and `Split`. The class order, neutrophil, epithelial, lymphocyte, plasma, eosinophil and connective as 1 to 6, comes from the CoNIC repository's README. The registry uses the full Lizard release from that mirror, not the CoNIC patch arrays. TODO: the `.mat` key `id`, which links each instance to its class, and the `Source` column of `info.csv` were not seen in any fetched source and come from memory, so the real-archive check must confirm them.

## Results

| Archive | Size in bytes | MD5 | SHA-1 equals the server's ETag | Images | Nuclei |
|---|---|---|---|---|---|
| PanNuke `fold_1.zip` | 700,275,281 | `e1b16ef84db3e3368d9f5bd4e61ed65c` | yes | 2,656 | 63,218 |
| PanNuke `fold_2.zip` | 658,842,552 | `f1839d332c4b8e12c7c01882020ac457` | yes | 2,523 | 59,872 |
| PanNuke `fold_3.zip` | 717,969,882 | `441950a966ee73d6e9780196815a0b20` | yes | 2,722 | 66,654 |
| MoNuSeg `MoNuSeg 2018 Training Data.zip` | 125,778,974 | `dfe849bcb72daec2a78ae5ba0ad10ade` | no ETag | 37 | 24,131 |
| MoNuSeg `MoNuSegTestData.zip` | 41,620,178 | `0721da0cdbd267299e0463419d70e1a5` | no ETag | 14 | 6,697 |

PanNuke nuclei per class, fold 3: neoplastic 28,471, inflammatory 10,825, connective 17,441, dead 1,057 and epithelial 8,860. Every fold covers 19 tissues. Between 1,216 and 1,572 pixels per fold carry ids in two class channels. The later channel wins those pixels. A separate streamed pass counted the distinct class and id pairs before the merge and the labels after it, and they are equal in every fold, so no nucleus disappears. Every image value is a whole number from 0 to 255, so the cast to 8 bits loses nothing. `fetch` downloaded the MoNuSeg test zip through Python's `urllib` into a temporary folder and verified it, and a HEAD request through `urllib` to Warwick returned 200 for fold 3.

| Dataset | Licence | Where it was read |
|---|---|---|
| PanNuke | CC BY-NC-SA 4.0 | the `README.md` inside each fold zip |
| MoNuSeg | CC BY-NC-SA 4.0 | ADR 0093 (evaluation metrics and datasets), from the challenge page |
| CryoNuSeg | MIT | the Kaggle dataset's metadata, read through Kaggle's public API on 2026-11-16 |
| Lizard | CC BY-NC-SA 4.0 | the metadata of a Kaggle mirror. TODO: confirm on the Warwick page, which needs a sign-in |

## Interpretation

- The three folds hold 189,744 nuclei, which fits the "~200,000 nuclei" of the PanNuke extension paper's abstract (arXiv 2003.10778). The MoNuSeg test set gives the 14 images and 6,697 nuclei of POC doc 26 (held-out benchmarks), which read the Hugging Face copy. Both loaders reproduce their sources.
- The ETag match makes the PanNuke pins verifiable rather than trust on first use. The MoNuSeg pins rest on the first download only.
- CryoNuSeg and Lizard are not checked on real data, so MLEVAL-010's "done when" line is only partly met. Decision 131 (how CryoNuSeg and Lizard reach the dataset cache) asks the owner how to get them. A public Zenodo record of the VitaminP project has both repackaged with published MD5s, and the POC's cached CryoNuSeg copy matches it.

## Follow-ups

- TODO for the owner: decision 131. Once the zips are cached, run `fetch` to get their MD5s, pin them, and add count tests like the PanNuke ones.
- TODO: move the POC's cached HoVer-NeXt outputs on PanNuke onto the `pannuke-fold1` and `pannuke-fold3` entries, as the [typing calibration reproduction](2026-10-18-typing-calibration-reproduction.md) asked.
