# Result: three exemplar nuclei and PathoSAM tokens find nuclei at PQ 0.754 on 39 TNBC images, 0.087 below prompting every true centroid

- Date: 2026-11-16
- Backlog: AISEG-014 (find more like these, exemplar prompting)
- Kind: spike
- Commit: the AISEG-014 commit that adds `parfocal_ml.exemplar_search`
- Environment: Apple M4, 24 GB, macOS 15.8.1, Python 3.14.10, onnxruntime 1.31.1 on `CPUExecutionProvider` with 4 threads. Three other agents shared the machine and a stray busy loop of this agent took one core for 3 minutes, so times are indicative only
- Data: all 50 TNBC v1.1 images (512 by 512, Zenodo, CC BY 4.0, public, no PHI) from `parfocal_ml.datasets`, 4,053 nuclei after vague ones are dropped. Graphs `pathosam.encoder_uint8.onnx` and `pathosam.decoder.onnx` from `~/.cache/parfocal/models/onnx`

## Question

POC doc 20 section 2.9 (text and exemplar prompts) suggests "find everything that looks like these three" on top of the click loop. Can the PathoSAM encoder tokens we already compute do that? The criteria were written into the ADR before the run: seeds hit 90% of nuclei with at most 20% wrong peaks, end-to-end PQ within 0.05 of prompting every true centroid, and a selectivity AUROC of 0.75 that beats the exemplars' mean colour.

## Method

```
pnpm --filter @parfocal/ml bench:exemplar-search -- --threads 4
```

Each image is encoded once at the 1024 px input, so one token of the 64 by 64 map covers 8 by 8 px of the 512 px image. A nucleus vector is the coverage-weighted mean of its unit-normalised tokens under the ground-truth mask. A prototype is the normalised mean of the exemplar vectors. Exemplars are drawn with seed 20261116 among nuclei of at least 80 px.

1. Retrieval, no decoding. For 1, 3 and 5 exemplars, 5 draws per image: the AUROC of cosine to the prototype for tokens at least half inside a nucleus against tokens with no nucleus pixel, and a size proxy, where exemplars come from the largest third of nuclei and the other large nuclei are ranked against the smallest third. The colour baseline ranks by distance to the exemplars' mean RGB.
2. Seeds. Local maxima of the cosine map in a 3 by 3 token window above a threshold. The threshold maximises seed F1 on images 1 to 10 and is reported on images 11 to 50. A seed hits a nucleus if its token centre lies in the mask. Exemplar nuclei are excluded.
3. End to end on images 11 to 50. Each seed prompts the full single-point decoder in Python. Masks with predicted IoU under 0.7, area under 20 or over 7,238 px, or IoU over 0.5 with a kept mask are dropped, and the largest component is traced with `skimage.measure.find_contours`. The control prompts every true centroid through the same path. Exemplar nuclei are passed as the ignore mask to `parfocal_ml.scoring`. This is a Python decode path, not the shipped TypeScript pass, so it is not comparable with the prompt-pass fallback's PQ 0.7959. After the run, lint changes moved the largest-component labelling from `scipy.ndimage.label` to `skimage.measure.label` with the same four-connectivity, and reformatted the file.

## Results

Retrieval, mean AUROC with the 10th and 90th percentile over draws:

| Exemplars | Nucleus vs background tokens | Large vs small, tokens | Large vs small, colour | Size draws |
|---|---|---|---|---|
| 1 | 0.538 (0.157 to 0.865) | 0.902 (0.742 to 1.000) | 0.648 (0.434 to 0.923) | 240 |
| 3 | 0.554 (0.214 to 0.808) | 0.934 (0.833 to 1.000) | 0.644 (0.459 to 0.870) | 220 |
| 5 | 0.542 (0.242 to 0.844) | 0.947 (0.838 to 1.000) | 0.670 (0.469 to 0.883) | 215 |

Seeds with 3 exemplars, threshold 0.80 picked on images 1 to 10:

| Images | Nuclei | Hit | Seeds | On background | On a nucleus already hit | Seed F1 |
|---|---|---|---|---|---|---|
| 1 to 10 | 622 | 500 (80.4%) | 1,553 | 1,020 | 6 | 0.466 |
| 11 to 50 | 3,281 | 2,793 (85.1%) | 9,693 | 6,705 | 84 | 0.434 |

End to end on images 11 to 50 (39 images, one image had too few nuclei of 80 px for three exemplars):

| Run | Decodes | Predicted | Recall | Precision | F1 | PQ | SQ | AJI |
|---|---|---|---|---|---|---|---|---|
| exemplar search | 9,693 | 3,160 | 0.857 | 0.890 | 0.873 | 0.754 | 0.864 | 0.704 |
| prompt at every true centroid | 3,281 | 3,227 | 0.970 | 0.986 | 0.978 | 0.841 | 0.860 | 0.848 |

Median encode 3,251 ms, median decode 25.2 ms, whole run 656 s.

## Interpretation

- Criterion 1 fails. Seeds find 85% of nuclei, and 70% of seeds land on background or on a nucleus already hit.
- Criterion 2 fails. PQ is 0.087 below the centroid control. The decoder and its IoU filter remove most wrong seeds, which is why precision recovers to 0.89, but it costs three decodes per nucleus.
- Criterion 3 passes on paper, 0.934 against 0.644 for colour, but the proxy is confounded. A small nucleus covers fewer whole tokens, so its pooled vector carries more background, and the token cosine partly measures size through that mixing. This is an assumption, not measured separately. It says nothing about cell kinds.
- Token cosine barely separates nucleus tokens from background (AUROC about 0.54). The SAM encoder at 8 px per token is a prompt map, not a semantic one, so the gesture would mostly fall back on the decoder to find objects.
- Real cell-kind selectivity is unmeasured, because no typed fixture is cached locally. SAM 3 concept prompts are unmeasured, because the weights are gated behind a sign-in. UNI2 and Virchow2 patch features are unmeasured for the same reason.

## Follow-ups

- ADR 0359 (find more like these) records the no-go.
- TODO: a typed fixture such as PanNuke would let a later run measure cell-kind selectivity.
