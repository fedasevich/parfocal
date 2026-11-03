# 0189. The developer drawer keeps the ten sections of the mock, and the debug handle is `window.__parfocal`

- Date: 2026-11-03
- Status: Proposed
- Deciders: Parfocal agents, owner to review
- Backlog: LAB-000 (research check for the developer drawer). Shapes LAB-001 (developer drawer), LAB-002 (performance HUD), LAB-003 (sample slides and synthetic data), LAB-004 (pan sweep benchmark and export) and LAB-005 (debug handle).

## Context

LAB-000 asks for the drawer's control list to be confirmed against the lab-tagged leaves of POC doc 34 (every action in the viewer, as a tree) and kit W25. Three sources were read on 2026-11-03.

- The frozen kit, `docs/design/ux-kit/index.html`. It has no W numbers any more. The backlog's `kit Wnn` references come from an earlier kit version, and the frozen round 6 kit shows the drawer as the gallery group "Developer mode, Viv by default" with ten stills: Renderer, Tiles and source, Annotations, Heatmap, Models, Typing and confidence, Whole-slide job, Benchmark, HUD, and URL and debug handle. Its interaction spec says renderer, tiles, models and benchmarks live in developer mode, and that speed against quality for a model is a developer mode setting, not a reviewer choice.
- The frozen mock, `docs/design/ux-mock/index.html`, screen `developer`. It is a drawer over the full viewer, titled Developer with a LAB tag, which reads "Hidden from doctors. Opens with ⌃⇧D or ?lab". Its notes say it holds every POC control: the lab panel, the HUD and every engineering URL switch, with Viv on WebGL2 as the default renderer. It cites doc 34 §10 for opening one local slide from the drawer. Its debug handle is `window.__wsi`.
- The PROTO-016 port in `apps/web`. `screens/developer/developer-data.ts` and `developer-screen.tsx` hold the same ten sections in four groups (Viewer, AI, Measure, Reference) and match the mock zone by zone. The page is the route `/developer`. The app gate today is a `localStorage` switch in `shell/developer-mode.ts` that the palette reads to show its Lab group. Neither ⌃⇧D nor `?lab` is wired yet. `docs/reference/permissions.md` gives `developer-mode` to researchers only.

The zones per section in the port are these.

| Group | Section | Zones |
|---|---|---|
| Viewer | Renderer | Renderer (Viv, WebGPU, deck.gl with its backend), Viv switches, Culling, sampling and motion (culling, interpolation, prefetch ahead of motion, motion vector, marked WebGPU only), Mouse wheel |
| Viewer | Tiles and source | Open a slide (path or URL, paged loading), Sample slides (15), Files (5 large slides) |
| Viewer | Annotations | Synthetic nuclei (off, 10k, 100k, 500k, 1M), Level of detail (off, fade, dots, density, tiered, fill opacity), CAMELYON16 annotations, Channels |
| Viewer | Heatmap | Show the heatmap, source, colormap, opacity, threshold, grid, synthetic field |
| AI | Models | Segmentation model, Auto segmentation, While moving (pause models while moving, prewarm when idle), MONAI server |
| AI | Typing and confidence | Cell typing, Confidence |
| AI | Whole-slide job | Whole-slide job, Running |
| Measure | Benchmark | Pan sweep, Runs, CSV columns (16) |
| Measure | HUD | Show the HUD, Corner, Frame probe, Readouts on the Viv route, Only on the WebGPU route |
| Reference | URL and debug handle | URL parameters (23), Model bench page (6), Debug handle (20 members) |

POC doc 34 was not read. The POC repository is private, it is not attached to this session, and attaching it was refused. Nothing in this repository quotes its lab-tagged leaves. So this record confirms the list against the kit, the mock and the code only.

## Options considered

1. Keep the drawer to the nine controls LAB-001 names. That drops the model, heatmap, typing, job and reference sections the mock and kit both show, and the kit puts model speed against quality there on purpose.
2. Keep all ten sections of the mock, as PROTO-016 already ports them, and treat LAB-001's list as the controls it must make live first.
3. Split the drawer per epic, with model controls in the AI epics. The mock and kit place every engineering control in one drawer behind one permission, so this would add a second hidden surface.

For the debug handle, the mock and the POC use `window.__wsi` and LAB-005 says `window.__parfocal`.

## Decision

Option 2. The drawer has the ten sections in the four groups above, with the zones the port already shows. Every one of LAB-001's nine controls is in it: renderer, culling, interpolation, prefetch and motion vector under Renderer, detail level and synthetic nuclei under Annotations, the HUD under HUD and pause models under Models.

The debug handle is `window.__parfocal`, as LAB-005 says. `__wsi` named the POC, and the product name keeps the handle from clashing with other tools on the page. Its members start from the mock's list of 20, and LAB-005 types them.

## Consequences

- LAB-001 builds the drawer with all ten sections, opened by ⌃⇧D or `?lab` and shown only with the `developer-mode` permission. Its nine named controls drive the viewer. The heatmap, model, typing and job zones drive their features once those tasks land, and until then they show the mock's values.
- LAB-002 keeps its readouts. The mock's Viv boxes show last decode, not decode p95, and show neither resident tiles nor the LOD tier, so the HUD adds those three. Atlas use stays in the WebGPU only box, as the mock marks it. The corner choice is top left, top right or bottom left.
- LAB-003 loads the 15 sample slides and 5 large files of Tiles and source, and the synthetic counts are off, 10k, 100k, 500k and 1M.
- LAB-004 exports the 16 CSV columns the Benchmark section lists.
- LAB-005 changes the reference text in `developer-screen.tsx` from `window.__wsi` to `window.__parfocal`.
- TODO: check the drawer against doc 34's lab-tagged leaves once a session can read the POC repository, then set this record to Accepted or amend it.
