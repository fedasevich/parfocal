# Result: two-finger click and Safari pinch listeners on the slide stage

- Date: 2026-11-09
- Backlog: DEV-013 (wire two-finger click and Safari pinch to the viewer)
- Kind: baseline
- Commit: the DEV-013 commit on its worktree branch
- Environment: Apple M4, macOS, Google Chrome headless through Playwright 1.64.0. No trackpad was used.
- Data: synthetic DOM events dispatched by the tests, no slides recorded

## Question

Do the DOM listeners turn a two-finger click and a Safari pinch into the negative point and zoom intents of DEV-002 (trackpad detection and gestures)? Do real traces from a Mac and a Windows touchpad agree?

## Method

1. `apps/web/src/devices/trackpad-listeners.ts` listens for `pointerdown` and `contextmenu` (two-finger click) and `gesturestart`, `gesturechange` and `gestureend` (Safari pinch). It feeds `mapInput` and hands each intent to the stage. The context menu is cancelled only when the press counts as a two-finger click, and the Safari events are always cancelled so the page does not zoom.
2. `slide-stage.tsx` binds it on the stage, applies zoom intents to the engine and writes the last intent kind to `data-trackpad-intent` on the slide host. The smart select layer reads a Ctrl click as a secondary press, so it adds a negative point.
3. `apps/web/test/trackpad-listeners.test.ts` drives each listener on a fake surface. `apps/web/e2e/trackpad-listeners.spec.ts` drives the real stage with dispatched events.

## Results

| Check | Result |
|---|---|
| Node tests for the listeners and the fixture converter | 8 passed |
| Browser test: Safari pinch zooms the camera and every gesture event is cancelled | passed |
| Browser test: secondary press gives `negativePoint` and its context menu is cancelled | passed |
| Browser test: Ctrl and primary press gives `negativePoint` | passed |

No timing or gesture numbers were measured. The events are synthetic.

## Recording real traces

1. Open `/spikes/input-traces` on the device. Pick "Mac trackpad" (run it in Safari and in Chrome) or "Windows precision touchpad". Each list now ends with a "two-finger click" step. Safari is the only browser that fires `gesturechange`, so record the pinch steps there.
2. Press Download JSON. The file goes into `packages/viewer-engine/test/input/traces` for the replay tests.
3. Press "Download trackpad fixture" for the same recording. It writes `<os>-<browser>-trackpad.recorded.json`, with the expectations the current code produces for each recorded event. Put it in `apps/web/test/fixtures/trackpad`, read the expectations once and raise the file count in `trackpad-traces.test.ts` from four.
4. Replace the matching `.synthetic.json` files and delete them once a recorded file covers the same device and browser.

## Interpretation

The listeners and their intents work for dispatched events. Whether a real Mac trackpad and a Windows touchpad produce the same event shapes (button 2 versus Ctrl and button 0, the scale values of `gesturechange`) is not yet checked.

## Follow-ups

- TODO: record the Mac trackpad in Safari and Chrome, and the Windows precision touchpad, with the recorder above. Until then the four fixtures stay synthetic and the DEV-013 hardware part stays open.
- TODO: confirm on a real Mac that a two-finger click in Chrome fires `pointerdown` with button 2, and in Safari with Ctrl and button 0.
