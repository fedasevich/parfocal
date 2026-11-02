# Outline casings against H&E, measured on CMU-1

Date: 2026-11-02. Task: VIEW-027 (outline rendering with casings). Test: `packages/golden-images/test/outline-contrast.test.ts`.

## Method

The share of pixels where neither the outline colour nor its casing reaches a WCAG 2 contrast ratio of 3:1 (the level WCAG 2.2 success criterion 1.4.11 asks for graphics needed to understand content). Colours are the class colours of the approved mock (`--c-tumor`, `--c-stroma`, `--c-immune`, `--c-other`) with the near-black casing `#0b0b0b`. A proposal is a near-black line on a white casing.

The pixels are every pixel of the three H&E frames of CMU-1.svs that are committed as goldens, at 10x, 40x and 80x (800 by 600 each, 1.44 million pixels in all). They are bare slide frames, so no overlay is in them. The numbers below come from a one-off run of the same function the test uses.

## Results

| Outline | Under 3:1 bare, 10x / 40x / 80x | Under 3:1 with casing, 10x / 40x / 80x |
| --- | --- | --- |
| Tumor | 92.5% / 93.7% / 93.3% | 6.3% / 5.9% / 6.1% |
| Immune | 91.4% / 92.8% / 92.4% | 5.2% / 5.1% / 5.2% |
| Stroma | 71.1% / 69.2% / 65.7% | 0.0% / 0.0% / 0.0% |
| Other | 75.8% / 74.9% / 72.8% | 0.0% / 0.0% / 0.0% |
| AI proposal, near-black on white casing | 13.8% / 12.3% / 12.9% | 0.0% / 0.0% / 0.0% |

The test asserts that every class outline with its casing stays under 10% over the three frames together, that a bare class outline fails on more than half of the pixels, and that a proposal fails on none.

## Reading

The POC measured 10% for a tumor outline and 8% for immune on its own 194,000 mock pixels (doc 35). On CMU-1 both are lower, at about 6% and 5%. The remaining pixels are a narrow band of mid-dark purple and brown, where the tumor red is too dark to reach 3:1 and the near-black casing is not yet 3:1 away. A lighter-than-near-black casing would not help, and a white second casing is not planned, so the tumor and immune outlines keep this residue.

The frames are one slide with one stain, so the figure is not a general claim about H&E. Other stains and scanners need their own frames if the gate is ever to be a promise to users.
