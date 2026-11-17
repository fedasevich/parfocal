# 0376. Study session replay is a first-party recorder with no recording library

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: EXP-009 (study session replay). Builds on EXP-008 (moderated test support).

## Context

EXP-009 asks for a replay of each study session with task chips, dead clicks and reloads, and a pointer-only fallback for when the screen recording is missing. The recorder must never capture typed text, must live only in study mode and must not weigh on the first page.

A recording library such as rrweb would give incremental DOM recording. It would also add a dependency to audit against the licence policy, record into the window it runs in (the task runs in a second window opened from the study page), and carry a script name that ad blockers match by URL.

## Decision

The recorder is written in this repository under `apps/web/src/study/trace/`. No recording library is added.

- The study page attaches the recorder to the task window it opened, both being same origin, and re-attaches when the task window loads a new document. A reload is told apart from other loads by the navigation type.
- The pointer, click and key log, task marks and the batcher are in the study screen. The DOM frame serialiser is a separate module, `dom-frames`, loaded with a dynamic import on the study page only. If that import fails, the start screen shows a warning and the session records the pointer, keys, routes and loads only.
- A frame is a masked snapshot of the body, taken after a load settles, after a task ends and at most every two seconds while the page changed. At most 400 frames are kept per session. Stylesheet links and inline styles are stored once per load.
- Every text field is masked in the serialiser. Input values are never copied. The text of textareas, editable regions, elements marked `data-private` and elements with the textbox role is replaced by bullets, as are their placeholder, title, alt and aria-label attributes. Scripts, event handler attributes, and data and blob URLs are dropped. A printable key typed into a text field is logged as a bullet, and only key names such as Enter are logged as is.
- Events go to a store in batches. A batch is written at every task start and end and once a minute, never per event. The store is IndexedDB in the moderator's browser behind a small sink interface, so a server upload can replace it later without touching the recorder.
- Replay draws the latest frame in a script-free sandboxed frame, moves a cursor from the pointer log and marks dead clicks (an interactive click with no page change within 800 ms) and reloads on a strip of task spans. Without frames it draws a wireframe from the logged route, viewport and click targets.
- Trace times use the real browser clock, not the app clock, because the app clock is fixed in fake-data runs.

## Consequences

- No new dependency and no licence review. We own the masking rules, so a test builds a page with a secret in every kind of field and proves the secret is absent from the frames and the replay document.
- Frames are snapshots, not incremental mutations, so replay is coarse between frames. It is enough to follow a task, and a library can replace the serialiser later behind the same frame shape.
- The slide canvas is not captured, so replay shows the page around the slide, not the slide pixels.
- Ad blockers match script names, so the module is named after what it does (`dom-frames`) and is served from our own origin. A blocker that still blocks it only costs the screen, not the log.
- Traces stay in the moderator's browser until the server upload exists, which is a separate task.
