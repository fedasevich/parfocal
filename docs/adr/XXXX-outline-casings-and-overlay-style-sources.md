# XXXX. Outlines carry a casing layer under them, and each overlay style value has a recorded source

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-027 (outline rendering with casings). Builds on [ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) (overlay layers as typed data over deck.gl). Touches VIZ-002 (how objects draw) and NAV-003 (slide brightness dial).

## Context

Class colours are light and so is pale tissue. The approved mock and doc 35 (a viewer built around a pathologist's sign-out) say that every class outline gets a thin near-black casing, and that AI proposals are near-black dashes on a white casing so they read as a selection and not as a class. The overlay layers of VIEW-026 (overlay layer system) drew a single coloured line. The owner also asked that the placeholder fill opacities and widths kept on 2026-10-31 be compared with the POC and with published conventions before this task is ticked.

## Options considered

How the casing is drawn:

1. One deck.gl path layer with a per-vertex outline colour in a shader extension. Fewer layers, but it needs a custom shader and the casing could not be dashed or coloured apart from the line.
2. A second `PathLayer` under each line layer, wider by the casing on each side, that shares the line's vertex array and carries a constant colour. Plain deck.gl, and the geometry is not copied.

How dashes are drawn:

1. Cut the polygon into dash segments on the CPU. It breaks on every zoom change unless the cut runs per frame.
2. `PathStyleExtension` from `@deck.gl/extensions` with `dashUnits: "pixels"` and `dashMode: "path"`, so a dash is 6 px and a gap 4 px at every zoom and the pattern runs on around corners.

## Decision

Option 2 for both.

- `VectorStyle` gains `casing` (a width added on each side and a colour, or `null`), `lineColor` (replaces the per-shape colour, or `null`) and `dash` (on and off in pixels, or `null`).
- Class kinds (human annotations, nuclei, measurements) get a near-black casing `#0b0b0b`: 1 px on each side for annotations and measurements, 0.5 px for nuclei so that a 1 px nucleus line shows as 2 px in all. AI proposals get a white casing of 1 px, a fixed near-black line `#0b0b0b` and the dash 6 px on, 4 px off. Point markers get the same casing as a ring that adds to the radius.
- The layers of a vector overlay come out as fills, outline casings, path casings, outlines, paths, points, so that no casing covers a neighbouring line.
- The class colours are `classColors` in `src/overlay/outline-style.ts` (tumor `#f87171`, stroma `#6ee7b7`, immune `#c084fc`, other `#fbbf24`), read from the mock, and a test fails if the mock changes them.
- Overlay colours are fixed sRGB in the layer data. Nothing in the overlay path reads the slide's display settings. The brightness dial (NAV-003) must therefore adjust the slide layers only, and its own golden test proves that overlay pixels keep their colour. No brightness control exists in the engine yet, so this task could not test it.
- The casing and the line are separate layers, each with the overlay's opacity. At an opacity below 1 the casing shows through the line a little. This is accepted, and the Display panel can set opacity back to 1.

## Where each value comes from

| Value | Final | Source |
| --- | --- | --- |
| Human annotation fill 0.18 | kept | POC overlay draft shapes use `rgba(.., 0.18)` and a 2 px line with a 6 and 4 dash (`poc/src/annotations/overlay.ts`). QuPath fills an annotation at opacity 0.3, and only when "fill annotations" is on, which is off by default (`ColorToolsAwt.getMoreTranslucentColor`, `OverlayOptions.fillAnnotations`). The kept 0.18 is a little lighter than QuPath's 0.3 so tissue still reads under it. |
| AI proposal fill 0.12 | kept | POC fills a proposal at `0.14 + 0.22 * confidence`, so 0.14 to 0.36, and a live preview at 0.08. A fixed 0.12 sits under the POC range on purpose, because confidence display belongs to the Display panel (VIZ-007). |
| Nucleus fill 0.3 | kept | QuPath fills detections and annotations by the same `getMoreTranslucentColor`, which is 0.3. |
| Measurement fill 0 | kept | A ruler or an area measure is an outline in the mock. No source fills it. |
| Line width 2 px | kept | POC `STROKE_WIDTH_PX = 2`. QuPath annotation and detection line thickness both default to 2.0 (`PathPrefs`). |
| Nucleus line 1 px plus 0.5 px casing each side | kept, casing added | POC and QuPath draw nuclei at 2. A 1 px line with 0.5 px casing is 2 px across in all, and the casing keeps the colour readable at that width. |
| Casing 1 px on each side | new | Mock and doc 35 say "thin". The mock's proposal swatch uses a 1.5 px ring on a 2 px line (`.layer .sw.prop`), the doc's script does not state a width. 1 px was chosen so the casing is visible at 2 px line width without a heavy frame. |
| Proposal dash 6 and 4 px | new | POC draft dash `[6, 4]` in device pixels. |
| Blue open pins and grey resolved pins | kept | Doc 35 says the one UI accent is blue and it marks comment pins, and chrome is neutral grey. The pin atlas draws open pins in `#60a5fa` and resolved ones in `#6b7280`, each with a near-black rim. The mock's accent token is `#94c0ff` in the dark theme and `#1d5fd1` in the light one, so the pin blue is close but not the same. Pins are not part of this task's outlines, so the value is kept and the difference is left for the comment pins task. |

No other published convention was checked, so none is claimed. WCAG 2.2 success criterion 1.4.11 is the 3:1 gate. The [measured contrast](../results/2026-11-02-outline-casing-contrast.md) has the numbers.

## Consequences

- `@deck.gl/extensions` 9.4.0 is a direct dependency of the engine, and was already in the lockfile through Viv.
- The seven overlay goldens and the stack golden are regenerated with the class colours of the mock. The fixtures in the harness use them.
- A casing doubles the path layers of a vector overlay. At 81,000 nuclei the casing layer shares the line's vertex array and adds draw work, which VIEW-028 (overlay level of detail) and its manual measurement must include.
