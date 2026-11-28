# Result: the signed report PDF against the on-screen report

- Date: 2026-11-28
- Backlog: PROTO-171
- Kind: baseline
- Commit: 728a11f8 for "before", the PROTO-171 branch for "after"
- Environment: MacBook, macOS 15.8.1, Google Chrome 158.0.8127.88 through Playwright, typst-py 0.15.0, fake API dev server
- Data: the signed scene of the fake Showcase sentinel node case S26-04812 (synthetic, no PHI)

## Question

Does the PDF that `pdf_of` draws look like the `ReportDocument` the screen draws for the same report, in font, sizes, weights, line heights and row gaps? The owner found on 2026-11-26 that it did not.

## Method

1. A Playwright script opened `/projects/<P03>/cases/<sentinel case>/report?scene=signed` on the fake API at 1440 x 1800, device scale 2, time zone Europe/Prague. It read the `model` prop of `ReportDocument` from the React fiber, the computed font, size, weight, line height and box of every text element, and saved an element screenshot of `[data-slot="report-document"]` (1190 px wide, 595 CSS px).
2. The screen uses IBM Plex Sans with `font-display: optional` ([ADR 0227](../adr/0227-self-hosted-plex-with-optional-font-display.md), self-hosted Plex). On the dev server the faces arrive after the block period, so the first capture drew the system UI font. The reference capture re-added the same `@font-face` sources with `display: block` and waited for them, so the screen draws Plex. The cold capture is kept as a third column.
3. `pdf_of`'s Typst source compiled the captured model to PNG at 144 ppi, which is 2 px per point, the same scale as the screenshot. The "before" source is the one at commit 728a11f8.
4. `compareFrames` from `@parfocal/golden-images` compared the top 1190 x 1400 px (700 pt) of both images with the `shot` tolerance (channel delta 24). The rest is cut because the screen prints "Page 1 of 1" inside the sheet and the PDF at the page foot.
5. pypdf read the PDF's text baselines. The screen baseline of each element is its top plus half the leading plus Plex's ascent, `top + (line height − 1.3 × size) / 2 + 1.025 × size`.

## Results

Pixel comparison, 1190 x 1400 px:

| Pair | Pixels differing | Mean channel error |
|---|---|---|
| PDF before against the screen in Plex | 11.20% | 16.68 |
| PDF after against the screen in Plex | 4.50% | 4.11 |
| Screen in the system font (cold load) against the screen in Plex | 8.57% | 12.83 |

Text baselines, in points from the page top:

| Text | Screen | PDF before | PDF after |
|---|---|---|---|
| Lab name, 13pt bold | 50.62 | 45.07 | 50.63 |
| Accession, first metadata row | 100.88 | 77.34 | 100.88 |
| ICCR standard line | 307.12 | 215.32 | 307.13 |
| CAP standard line | 322.62 | 224.60 | 322.63 |
| TNM standard line | 338.12 | 233.88 | 338.13 |
| Deposit D1 row | 431.88 | 299.32 | 431.88 |
| Deposit D2 row | 450.38 | 312.00 | 450.38 |
| Signature line | 641.88 | 445.20 | 641.88 |
| Largest offset over all 38 matched lines | | 209.46 | 0.01 |

Pitches the screen draws and the PDF drew before:

| Gap | Screen | PDF before |
|---|---|---|
| One synoptic row to the next | 18.5 | 12.68 |
| Standards line to standards line | 15.5 | 9.28 |
| A wrapped label's second line | 16.5 | 13.73 |

The screen's computed values were IBM Plex Sans throughout, body 11px at weight 400 and 16.5px line height, values 600, section headings 10px 700 with 15px line height, the head 13px and 12px 700, small text 9px with 13.5px line height and the page line 8px. With Plex drawn, "Total number of sentinel lymph nodes examined:" measured 240.2px on screen. In the system font it measured 253.7px and wrapped.

## Interpretation

- The crowding came from Typst's line box. Before, a one-line grid row was cap height to baseline, 7.7pt at 11pt, plus a 5pt gutter, while the screen gives every line 16.5px. With the CSS line box and the screen's gaps ported, every baseline sits where the screen puts it.
- The remaining 4.5% of differing pixels sit on glyph edges, where Chrome and Typst antialias differently, and on the signature rule, which Chrome snaps from 620.5 to 621 px. No text or rule is displaced.
- This run does not explain the "different, larger face" the owner saw. The PDF always embeds Plex, while a cold load of the screen drew the system font, which ran about 5% wider, so that case would make the PDF look narrower, not larger. A PDF viewer at 100% zoom draws 1pt as 1.33 CSS px, which may be what looked larger. Assumption, not measured: on the deployed app, too, the faces can miss the optional block period on a first visit. Weight 700 was not preloaded in `apps/web/index.html`, so bold headings were the likeliest to fall back. The lead chose to preload weight 700 next to 400 and 600, and the same branch adds it, so no owner decision is needed.
- The time zone gap is fixed separately. The download link now sends `?zone=` with the browser's zone. Tests pin 21:17 UTC to 22:17 in Prague on both the screen and the PDF side.

## Follow-ups

- ADR XXXX (report PDFs print the reader's time zone and lay out text in the screen's line box), which amends ADR 0443 (one Typst report layout for every PDF).
- The font loading question above is settled: the lead chose to preload IBM Plex Sans 700 in `apps/web/index.html`, and `e2e/font-preload.spec.ts` checks it. No owner decision is needed.
- The lead checks the deployed Showcase case's PDF against its preview.
