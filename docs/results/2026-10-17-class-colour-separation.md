# Result: Class colour separation for the taxonomy templates and the API check

- Date: 2026-10-17
- Backlog: PROJ-004 (class taxonomy per project)
- Kind: baseline
- Commit: 81d8c7c plus the uncommitted PROJ-004 change (`apps/api/src/parfocal_api/colours.py`, `class_templates.py`, `taxonomy.py`)
- Environment: MacBook, macOS 15.8.1, Python 3.14.7, Node.js 26.9.0 for the POC comparison. No browser or GPU involved
- Data: colour values only. The sentinel node classes and the reserved marks come from the hi-fi mock's tokens (`--c-tumor` #f87171, `--c-stroma` #6ee7b7, `--c-immune` #c084fc, `--c-other` #fbbf24, unsure #cbd5e1 dark and #475569 light, AI proposal #0b0b0b, unsure zones white)

## Question

Which minimum CIEDE2000 distance should the API demand between class colours, and which colour should PanNuke's fifth class, Epithelial, get? The mock reuses the "other" amber for both Dead and Epithelial. The baseline is POC [doc 35](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/35-ui-ux-for-pathologists.md): closest class pair 15.1 under deuteranopia, AI proposals at least 40 from every class, unsure marks at least 13 from every class on the slide and 15 in the panel.

## Method

`parfocal_api.colours` ports `sRGB → linear → Machado et al. (2009) simulation → sRGB (rounded half up, as JavaScript's Math.round does) → CIELAB (D65) → CIEDE2000` from the POC's `scripts/color-check.mjs`. The port was compared with the POC's own functions by running both on the three closest pairs under Node and Python. Distances are taken under normal vision and each of protanopia, deuteranopia and tritanopia, and the smallest one counts. The fifth PanNuke colour was searched over an HLS grid (hue every 3 degrees, lightness 0.40 to 0.88 in steps of 0.04, saturation 0.4, 0.6, 0.8 and 0.95), keeping only colours that meet every reserved-mark limit, ranked by their smallest distance to the four existing classes.

## Results

POC script and Python port on the same pairs:

| Pair, vision | POC JavaScript | Python port |
|---|---|---|
| Stroma and other, protanopia | 19.522852630682436 | 19.522852630682433 |
| Tumor and stroma, deuteranopia | 15.102366896894713 | 15.102366896894717 |
| Tumor and other, tritanopia | 17.188485235985873 | 17.188485235985873 |

Best fifth colours that meet every reserved-mark limit:

| Colour | Smallest distance to the four classes |
|---|---|
| #b006db | 17.7 |
| #43999d | 17.1 |
| #43949d | 16.6 |
| #29a3a3 | 15.8 |

Templates as shipped, smallest class pair per vision:

| Template | Normal | Protanopia | Deuteranopia | Tritanopia |
|---|---|---|---|---|
| Sentinel node | 32.5 (tumor, immune) | 19.5 (stroma, other) | 15.1 (tumor, stroma) | 17.2 (tumor, other) |
| PanNuke with Epithelial #43999d | 25.8 (connective, epithelial) | 17.8 (neoplastic, epithelial) | 15.1 (neoplastic, connective) | 17.2 (neoplastic, dead) |

Templates against the reserved marks, the closest class over all four visions:

| Mark | Limit | Sentinel node | PanNuke |
|---|---|---|---|
| Unsure zones on the slide, #ffffff | 13 | 13.8 (stroma) | 13.8 (connective) |
| AI proposals, #0b0b0b | 40 | 43.7 (tumor) | 42.8 (epithelial) |
| Unsure in the dark panel, #cbd5e1 | 15 | 15.5 (stroma) | 15.5 (connective) |
| Unsure in the light panel, #475569 | 15 | 30.4 (tumor) | 20.7 (epithelial) |

## Interpretation

- The port matches the POC to the last digits. Doc 35 reports 19.6 for protanopia because the stroma or other token was a little different when it was written. The deuteranopia figure, which sets the threshold, is unchanged at 15.1.
- A limit of 15 between classes is the most the current kit palette allows, so the API takes 15 and lets every template pass. Assumption: a taxonomy that a person cannot tell apart under one of the three common deficiencies is worse than one that rejects a chosen colour.
- #43999d, a teal, is the second-best fifth colour. The best one, #b006db, is a second purple next to Inflammatory's #c084fc, so the teal was taken for a distinct hue.
- The stroma green is only 0.8 above the white limit and 0.5 above the dark-panel unsure limit, so any kit change to it must rerun this check.

## Follow-ups

- [ADR 0067](../adr/0067-class-taxonomy-and-colour-check.md) records the rule and the templates.
- TODO: DS-002 (colour measurement scripts in CI) should check the kit tokens with the same limits, so the design tokens and the API never disagree.
- TODO: the design owner should confirm #43999d for Epithelial in the UX kit.
