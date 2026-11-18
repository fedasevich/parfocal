# 0398. Every viewer screen draws the slide through one engine stage

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-074 (every viewer screen draws the real slide through one engine stage). Builds on [ADR 0129](0129-the-prototype-moves-into-react-as-the-design-source.md) (the prototype moves into React as the design source).

## Context

On 2026-11-17 the owner opened a review task's slide on the deployed app and saw a blurred broken picture with outlines floating over it, buttons that did nothing, tools that did not act on the slide and a slide that would not pan. The full viewer, guided review, annotate, annotate task and compare screens came over from the prototype. They draw `SlideStill`, a fixed photo from `/mock-assets/` with outlines placed in that photo's coordinates, and use the Viv engine only as an optional backdrop behind it. The photo is not deployed. The real engine stage (`viewer/slide-stage.tsx`) already pans, zooms, measures, comments and annotates on the real slide, but only on the separate `/live` route. Two viewers meant every fix landed in one and not the other.

## Options

1. Keep `SlideStill` and make its backdrop sturdier, so the photo never shows. Tools and outlines stay in photo coordinates and still miss the real slide.
2. Put every slide screen on the one engine stage, with the mock's frame around it (the live top bar and stage inspector), and rebuild each screen's own parts (decision buttons, object list, guided steps, compare) as cards and layers that act through the stage's engine.

## Decision

Option 2.

- `viewer/engine-viewer.tsx` is the one viewer screen. The `/live`, full viewer, guided review, annotate and annotate task routes all render it. Each keeps its prototype screen only when a prototype `scene` is in the address, which only the prototype gallery and Storybook links set.
- Guided review is the same stage with the objects card in guided mode: one object at a time, a decision moves to the next open object, and the camera flies to each object that has an outline.
- The stage takes screen parts through one narrow slot (`extras` on the inspector link), which receives the stage's engine and module. Review objects, decisions and the start camera from a deep link live there, outside `slide-stage.tsx`.
- Review objects are drawn on the real slide only when they carry an outline in slide pixels. An object without one is listed and can be decided, but is never drawn at a guessed place.
- A slide that cannot open shows the stage's notice, never a stand-in picture.

## Consequences

Pan, zoom, tools, overlays and the minimap act on the real slide in every screen that moves over. Prototype only parts of the old full viewer, such as the cell grid, type bar and object table, are not on the engine viewer until a task brings them over, and the prototype gallery still shows them. Compare, focus mode and the prototype only parts of guided review (decision notes, cell grid, coach marks) move over in later tasks, and `apps/web/test/no-prototype-in-production.test.ts` lists what is left. Going back to two viewers would mean keeping two sets of tools in step again.
