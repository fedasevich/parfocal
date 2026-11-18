# Result: the live viewer's notice banner, reviewed and rebuilt within option A

- Date: 2026-11-18
- Backlog: PROTO-028 (the live viewer's one banner shows what a reviewer must notice, one notice at a time)
- Kind: check
- Commit: the PROTO-028 commit on top of 0605d42b
- Environment: MacBook, macOS 15, Chrome through Playwright, the fake API dev server, a 940 px wide page
- Data: the fake API's sample project and its fictional slide `tumor_044`. No PHI

## Question

The owner answered question 144 in `docs/decisions.md` (where the save status, the marker for a colleague's changes and the edit conflict notice go) with option A, the one banner under the top bar plus a quiet save word in the top bar, and asked for the best version of it. What does a reviewer have to notice, what should stay quiet, is it accessible, and what happens when two states meet?

## Method

1. Read `apps/web/src/viewer/stage-notices.tsx`, the three notices it placed, `apps/web/src/annotations/save-queue.ts` and the browser specs `autosave`, `edit-conflict` and `live-layer`.
2. Rebuilt the notices as `ViewerNotices` and `SaveStatusWord` in `packages/ui/src/components/viewer-notices.tsx`, with the choice of what shows in the pure function `planNotices` in `packages/ui/src/lib/viewer-notices.ts`.
3. Ran `packages/ui/test/viewer-notices.test.ts` (7 tests), `packages/ui/e2e/viewer-notices.spec.ts` (6 tests), the axe spec for the 9 new stories in light and dark, and the four app specs `edit-conflict`, `autosave`, `live-layer` and `viewer-mock-layout` (12 tests). All passed.
4. Measured the layout shift once in `edit-conflict.spec.ts` by reading the bounding boxes of the stage and of the drawn polygon with the conflict notice open and after Keep mine closed it.

## Results

What the review found in the PROTO-023 (the live viewer's top bar, tabs and hints match the frozen mock) build, and what changed:

| # | Found | Changed to | Why |
|---|---|---|---|
| 1 | "Some edits were not saved" was a small word in the top bar that could be cut off, and the next good save replaced it with "All edits saved" | A red banner that stays until Dismiss, and the red word stays with it | Lost work is the one thing a reviewer must not miss. It has no Retry because the queue drops a refused edit |
| 2 | "Not connected" showed only as the word, however long it lasted | The word for a short blip, and a banner with Try now once 3 tries in a row have failed, about 3 seconds plus the request time | A blip should not flash a banner, a long cut needs a clear notice and a way to act |
| 3 | The conflict notice had `role="alertdialog"` and never took focus, with one fixed element id | A labelled group. Nothing takes focus while the reviewer draws. Tab reaches the buttons because the banner follows the top bar | A dialog role without focus misleads a screen reader, and stealing focus breaks an outline in progress |
| 4 | With several conflicts the focused button stayed in place, so a second Enter answered the next conflict unseen | After a choice, focus moves to the next conflict's title, so a second Enter does nothing | Each conflict needs its own look |
| 5 | The marker for a colleague's changes was one wide button, never announced | An info banner with the text and a real Show changes button, announced politely | A screen reader user never learned that changes waited |
| 6 | "Saving" and "All edits saved" had `role="status"`, so each edit was announced, and the word repeated the conflict sentence | The word has no live role and is empty during a conflict. Two hidden live nodes announce only the banner, assertive for conflict, not saved and long offline, polite for a colleague's changes | Routine saves stay quiet, trouble is announced once |
| 7 | Two notices stacked, the marker above the conflict | One notice at a time in the order conflict, not saved, long offline, colleague's changes, with a line "Shown next: ..." naming the rest | The reviewer answers the most urgent one first and the banner stays one notice high |
| 8 | The save word followed the queue phase alone, where a refused save wins over an open conflict | The plan reads the facts (conflict count, the not saved latch, retry count, waiting changes) instead of the phase alone | The phase holds one state and loses pairs |
| 9 | Mine and theirs differed only by colour, and Keep theirs was the primary button | Theirs is a dashed, thicker outline and the text says so. Both buttons have equal weight | Colour alone fails colour-blind readers, and neither answer should be pushed |
| 10 | The preview was 96 px tall with the buttons under the text | A 64 px preview with the buttons on the right | A lower banner moves the slide less |

Layout shift, measured with the new conflict notice:

| | Stage top | Stage height | Polygon top |
|---|---|---|---|
| Conflict notice open | 129 px | 591 px | 325.5 px |
| No notice | 44 px | 676 px | 283 px |

The notice is 85 px high and the polygon moves 42.5 px on screen. The old notice's height was not measured.

## Interpretation

The banner sits in the page flow, as option A says, so every open and close resizes the canvas and the camera keeps its centre. The shape therefore moves by half the banner's height. A conflict opens just after the reviewer's own edit is saved, so the jump lands between gestures, but a colleague's changes can open the banner in the middle of an outline. This is not fixed here.

The 3 retries before the offline banner is a judgement, not a measured value. The waits after the first and second failed try are 1 and 2 seconds, so the banner appears about 3 seconds plus the request time into a cut.

## Follow-ups

- PROTO-029 (the slide stays under the pointer when the live viewer's banner opens or closes) is added for the measured shift.
- The focus view has its own pair of slots (`focus-notices` in `apps/web/src/viewer/engine-viewer.tsx`). The same components draw into it, and no browser test covers it. TODO cover it with PROTO-029.
- No key moves focus from the canvas to the banner. Tab from the top bar reaches it. TODO decide whether a shortcut is wanted once a screen reader user tries the viewer.
- The Czech catalogue has no translations yet, so the new strings are English only like the rest.
