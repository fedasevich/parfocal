# @parfocal/viewer-engine

The framework-free viewer engine: camera, input, renderer routes, slide readers and decode workers ([ADR 0100](../../docs/adr/0100-viewer-hot-path-state-outside-react.md)).

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @parfocal/viewer-engine test` | Unit tests on `node --test`, with an injected clock and frame scheduler |
| `pnpm --filter @parfocal/viewer-engine test:browser` | Playwright suites in `browser/`: memory and teardown, pan fetches, deck settings and input |
| `pnpm --filter @parfocal/viewer-engine traces:record` | Opens the input trace recorder in the default browser |

## Input

`bindViewerInput(element, engine, options)` in `src/input/dom-input.ts` maps pointer, wheel and double-click events onto the engine's camera calls ([ADR 0107](../../docs/adr/0107-viewer-input-binding.md)). The rules live in the pure interpreter in `src/input/gestures.ts` and the wheel maths in `src/input/wheel.ts`, so they run in unit tests without a DOM. The options are the wheel mode and three hooks for the active tool: `primaryDragPans`, `panModifierHeld` (Space until the key registry exists) and `hitsEditableShape`.

## Recording input traces

The replay tests in `test/input/trace-replay.test.ts` run every JSON file in `test/input/traces/`. The files there now are synthetic and are named `*.synthetic.json`. Real recordings replace or join them.

1. Run `pnpm --filter @parfocal/viewer-engine traces:record`. Vite serves `browser/page/trace-recorder.html` and opens it.
2. Pick the device, Mouse or Trackpad or touchpad, and type a label such as "Magic Trackpad on macOS 15".
3. For each gesture, click it, press Record, do the gesture over the pad once and press Stop. Scroll down and up, pinch out and in, Ctrl+wheel and Shift+wheel are the important ones. Drag, middle drag and the double-clicks matter for a mouse.
4. Press Save JSON. The file is named like `trackpad-macos-chrome.recorded.json`.
5. Move it into `test/input/traces/` and run `pnpm --filter @parfocal/viewer-engine test`. A failing gesture on a real device is a finding, so note it in `docs/log.md` before changing the rules.

Record a mouse, a Mac trackpad and a Windows precision touchpad, in Chrome first. A file holds only event types, deltas, positions, modifier keys and the user agent, never anything about a patient.
