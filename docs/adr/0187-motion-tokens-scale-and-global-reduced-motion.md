# 0187. Motion tokens scale with one variable, and reduced motion is a global cut in CSS

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: DS-016 (motion tokens and reduced motion). Builds on PROTO-011 (every kit component in rough form) and [ADR 0104](0104-camera-controller-motion.md) (camera controller motion).

## Context

DS-016 asks for durations from 120 to 400 ms, easing tokens, a slow presenting mode at one third speed and reduced motion that turns every transition into a cut. The kit's timing table names a 300 ms ease for the minimap and a 400 ms flight, and says that under reduced motion all moves become instant. The frozen mock has a Motion switch with Normal and Slow, for presenting. Before this task `@parfocal/tokens` held no motion values, the components used Tailwind's default 150 ms or fixed classes such as `duration-100` and `duration-[280ms]`, and only the magnification bar honoured reduced motion, with `motion-safe:`. The viewer engine already turns camera flights and coasting into cuts under reduced motion ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)).

## Options considered

1. Mark every transition `motion-safe:` and add a presenting variant per component. Exact, but every new component must remember it, and fixed durations cannot slow down.
2. Hold the durations as CSS variables multiplied by one `--motion-scale`, set by a `data-motion` attribute (`normal` 1, `presenting` 3, `reduced` 0), and add one global rule under `prefers-reduced-motion: reduce` and under `data-motion="reduced"` that sets every transition and animation duration and delay to 0 with `!important`, view transitions included.
3. Drive motion from JavaScript with a context that components read. It reaches CSS transitions only through inline styles and adds a render path for a styling concern.

## Decision

Option 2.

| Part | Rule |
|---|---|
| Durations | `--motion-fast` 120 ms, `--motion-base` 200 ms, `--motion-slow` 300 ms, `--motion-slower` 400 ms, each `calc(base * var(--motion-scale))`, declared on `:root` and on every `[data-motion]` element so a subtree can switch mode |
| Easing | `--motion-ease-standard`, `-enter`, `-exit` and `-in-out` (the cubic in and out the camera flight uses), exposed to Tailwind as `ease-standard`, `ease-enter`, `ease-exit` and `ease-in-out` |
| Tailwind default | `transition`, `transition-colors` and the rest default to `--motion-fast` and the standard ease |
| TypeScript | `motionDurationsMs`, `motionEasings`, `motionModes`, `motionScale`, `motionMs` and `effectiveMotionMode` for code that times things itself |
| Reduced motion | The global rule makes every transition and animation a cut, whatever class a component uses |

## Consequences

- New components get reduced motion for free and should use `duration-(--motion-*)` so presenting mode slows them too.
- Components with fixed durations (`duration-100` in dialogs and menus, 280 ms in the magnification bar) are cut under reduced motion but do not slow down for presenting until they move to the tokens. TODO: a later DS task moves them.
- A spinner stops under reduced motion and shows as a static ring.
- The camera keeps its own reduced motion switch in the viewer engine. Its cubic in and out matches `--motion-ease-in-out`, so ADR 0104's open item is met without changing the controller.
- The setting that writes `data-motion` on the document (presenting mode, or a forced reduced mode) belongs to the settings tasks.
