# Result: the viewer frame's small parts after PROTO-038, by number

- Date: 2026-11-18
- Backlog: PROTO-038 (the viewer frame's small parts match the mock). Follows the audit in [2026-11-18-viewer-mock-drift.md](2026-11-18-viewer-mock-drift.md), rows 10 to 16
- Kind: check
- Commit: the PROTO-038 commit on top of 950fd16e
- Environment: MacBook, macOS 15, Chrome through Playwright, 1440x900 at scale 0.5, light theme. The Mac was shared with two other agents, so nothing here is a timing
- Data: the fake API, project `00000000-0000-4000-8003-000000000007`, slide A1 `…8005-000000000001`, review task RT-14 `…8007-000000000014`, viewed as Lenka Malá (`as=LM`). The mock's own fictional demo slide. No PHI

## Question

Do the seven frame details of the audit now match the frozen mock, and what is the new baseline shot of the inspector and the magnification bar?

## Method

1. Served the mock with `python3 -m http.server 7198` and the app with the fake API on port 5199.
2. A Playwright script read the box, colours, corner and text of each part in the mock's `case` screen and in the app, before and after the change.
3. `pnpm --filter @parfocal/web shot APP_URL out.png --against PNG --wait 9000` gave the share of differing pixels. The new baseline is [app-review.png](2026-11-18-viewer-frame-parts/app-review.png), the whole 1440x900 review screen, which holds the inspector and the magnification bar.

## Results

| Pair | Differing pixels | Mean error |
|---|---|---|
| App after against the audit's before shot `2026-11-18-viewer-mock-drift/app-full-viewer.png` | 1.6% | 1.3 |
| A second app shot against the new baseline `app-review.png` | 0.0% | 0.0 |
| App after against the mock `2026-11-18-viewer-mock-drift/mock-case.png` | 72.2% | 38.8 |

The last number barely moves from the audit's 71.9%, because the slide picture and the Objects tab's contents still differ. Those belong to other tasks.

| Row | Part | Mock, measured | App before | App after |
|---|---|---|---|---|
| 10 | Tabs | "Objects 55", "Comments 3" | No counts | "Objects 55", "Comments 3". Comments counts open threads. Task RT-14 has a fourth, resolved thread |
| 11 | Panel and cards | Panel `rgb(255, 255, 255)`, cards `rgb(244, 244, 244)` with a 1 px `rgb(228, 228, 228)` edge and a 12 px corner | White panel, white cards with a `rgb(221, 221, 221)` edge and an 8 px corner | The mock's values on every docked card |
| 12 | Panel foot | None | A 29 px foot with "Hide while panning" and a pop-out button | None. The dock is as tall as the panel |
| 13 | Rail foot | "Compare slides" | "Hide the side panel" | "Compare slides", which opens the compare view with the right side picker open |
| 14 | Tool on open | Select | Pan | Select. A drag on empty tissue still pans in Review |
| 15 | Magnification bar | 38 px tall, 10 px corner, 12 px from the bottom, steps "1.25×" to "40×" | 151x42, 12 px corner, 16 px from the bottom, first step "1.3×" | 38 px tall, 10 px corner, 12 px from the bottom, steps "1.25×" to "40×" |
| 16 | Hint bars | One line | Smart select wrapped to 524x96 | One line, 38 px tall. Smart select fills the 1,024 px it may use and clips its last hint pill |

The audit's row 11 wrote the mock's colours the wrong way round ("a grey panel with white cards"). The mock's computed styles are a white panel with grey cards, and the app now follows those.

The bar's width depends on the camera. The mock's 216 px was read at 0.29× with a 5 mm scale bar. The app opens RT-14 at 20× with a 20 µm scale bar and is 95 px wide there.

## What it means

The seven details are closed and `apps/web/e2e/viewer-frame-parts.spec.ts` holds them. The side panel's pop-out button went with the foot, because the mock has none. The `/popout?kind=inspector` window still works and `popout-sync.spec.ts` opens it by address.

TODO: the smart select hint bar needs about 100 px more than a 1,048 px canvas gives, so one hint pill is clipped at 1440x900. A shorter class strip or a smaller Close button would fit it.
