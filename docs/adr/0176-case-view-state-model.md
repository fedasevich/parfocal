# 0176. The case view state model: the slide and workspace in the path, the view in the URL, camera memory per slide while the case is open

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: CASE-000 (research check for the case view). Read by CASE-003 (per-slide view memory) and the rest of the CASE epic (slide view).
- Partly superseded: the camera memory that lives only while the case is open is replaced by [a slide's camera remembered on the device across visits](0229-slide-camera-remembered-per-device.md) (2026-11-04).

## Context

Since [ADR 0053](0053-ai-results-review-direction.md) the case view is a slide view, and a case is only an optional group of slides with no state of its own ([ADR 0057](0057-no-case-state-machine.md)). [ADR 0143](0143-client-ui-state-zustand-and-xstate.md) gives every kind of client state one home, and [ADR 0048](0048-routing.md) puts shareable view state in typed search params. The PROTO port already built the screens, so this record names what they hold and where, and fixes the rules the CASE tasks build on.

What the code does today, read on 2026-11-03:

- The review workspace is `/projects/$projectId/slides/$slideId`. Its Zod schema (`routes/projects.$projectId.slides.$slideId.tsx`) holds `task`, the camera `x`, `y` and `z`, `object`, `tab`, `scene`, `tool`, `focus`, `peek` and `modal`. Changes write with `replace`, so they add no history entries.
- Other workspaces on the same slide are sibling routes: `annotate`, `report`, `co-sign` and `live`. Guided review is `/tasks/$taskId/guided?slide=`, with its own `tab` of review, comments or display.
- The inspector tabs of the review workspace are `viewerTabs` in `screens/viewer/viewer-scenes.ts`: objects, display, comments and opinion. Objects is the default.
- The selected area or object is `object`. Picking one clears `x`, `y` and `z`, so the view frames the object.
- `full-viewer.tsx` keeps the live camera in React state, writes it to the URL 250 ms after it stops changing, and writes it to the per-slide memory on every change.
- `screens/review/slide-switch.ts` keeps that memory in a module map from slide ID to a complete `{ x, y, z }`. The slides popover and the Q and E keys build the next slide's link with `recallSlideCamera`, so a slide opens where the person left it. `forgetSlideCameras` exists, but only tests call it.
- The case is not in the URL. The top bar finds it from the slide's case label, and Q and E step through the case's slides, or through the task's slides when there is no case.
- In guided review the current object is a local `index`, which starts at the scene's focus or the first open object. The route schema has an `object` key that the screen does not read. The server's `ResumeTarget` names the task, slide, position and object to resume.

## Decision

The case view state has five parts, and each has one home.

| Part | Meaning | Home | Rule |
|---|---|---|---|
| Slide | The slide on screen | Path, `slides/$slideId` | The case and its other slides are derived from the slide through Query, never put in the URL |
| Workspace | What the person is doing with the slide: review, annotate, report, co-sign, live or guided review | Path segment, plus `focus` and the compare `scene` as modes of the review workspace | Changing the workspace keeps the slide and the task |
| Inspector tab | Objects, display, comments or opinion in review, and review, comments or display in guided review | Search param `tab`, default objects or review | The tab follows the person, so switching slides keeps it |
| Area | The selected area, object, cell or measurement | Search param `object` | Object IDs belong to one slide, so switching slides clears it. Picking an object clears the camera params so the view frames it |
| Review position | Where the person stands in the task: which objects are decided and which comes next | Decisions in Query, with the current object in `object` | Never stored on its own. The next object is the first open one in reading order, computed from the decisions. Home resumes from the server's `ResumeTarget` |

The camera follows these rules.

- The URL carries the current slide's camera as `x` and `y` from 0 to 1 of the slide and `z` as the scale, written 250 ms after the camera stops, with `replace`. A pasted link opens the same view.
- Per-slide camera memory maps a slide ID to the last complete camera of that slide. It is written when the camera of that slide changes and read only when a link to another slide of the same case is built, from the slides popover, Q and E, or any later switcher. It holds settled values from user actions, never frames, as ADR 0143 asks.
- The memory lives while the case is open. It is cleared when the person opens a slide of a different case or a slide with no case, and when they sign out. It is not kept across a reload or on the device, because the URL already restores the slide on screen and the other slides open fitted.
- The memory is keyed by slide only. Any workspace that shows a slide's camera reads and writes the same entry, so leaving review for annotate and coming back keeps the view.
- On opening a slide the camera is chosen in this order: `x`, `y` and `z` in the URL, then the frame of `object`, then the slide fitted. The remembered camera reaches the slide only by being put into the link, so there is one order to test.

## Consequences

- CASE-003 (per-slide view memory) clears the memory when the case changes and on sign out, and tests that switching away and back restores the view in every way a slide is switched. It may move the module map into a small Zustand store under ADR 0143 if a second reader appears, and keeps the same API.
- The slides popover and Q and E links do not carry `tab` today, so a switch falls back to objects. The next task that touches `slide-switch.ts` or the popover passes it through.
- Guided review should read and write `object` instead of a local index, so that a link and a reload return to the same object. The task that next changes guided review does this.
- Screens other than review do not read the memory yet. Each workspace task that adds a camera adds the read and the write.

## Alternatives

- One camera per case, shared by its slides. Rejected because slides differ in size and tissue position, so a shared view lands on glass.
- Keeping every slide's camera in the URL. Rejected because the link grows with the case and a colleague needs only the slide on screen.
- Keeping the memory on the device across visits. Rejected for now. Nothing in the kit or the mock asks for it, and a stale view on reopening a case days later would hide where the AI points. The settings layers ([ADR 0138](0138-settings-catalogue-in-python-resolved-in-the-browser.md)) can add it later.
- Storing the review position as its own value. Rejected because it can disagree with the saved decisions, which already say what is open.
