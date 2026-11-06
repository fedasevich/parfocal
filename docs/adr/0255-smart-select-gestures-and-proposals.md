# 0255. Smart select keeps each object as a pending proposal in one model run and takes the best of four candidate masks

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-005 (smart select tool). Builds on [ADR 0253](0253-sam-inference-worker.md) (one inference worker answers only the latest prompt)

## Context

The smart select tool turns clicks and a drag on the slide into outlines from the PathoSAM decoder. The POC settled most of its interaction in documents 13 and 14. A plain click once refined the live proposal, so forty nuclei needed forty clicks and forty presses of Enter. A mask derived into a box made accuracy worse (document 20 section 2.7). The decoder accepts the previous low-resolution logits as `mask_input`, which the POC client never filled. The app already has a proposals lifecycle (pending pieces in model runs, accepted into shapes or dismissed, one undo step each) and a context bar with Accept and Discard.

## Options considered

1. Keep the live object and its refinement points in a separate draft that becomes a shape on Enter. The proposals lifecycle, the context bar buttons and the Escape rung would each need a second path for this tool.
2. Write every outline of the tool into one model run in the annotation document as a pending piece, and rebuild that run whenever the live outline changes. Accept, Discard, Enter, Escape and undo then work as they do for any proposal.
3. Accept each outline the moment the next click starts. It saves the Enter key, but a wrong outline is already a saved shape when the user notices it.

## Decision

Option 2.

- A plain click is a positive point and starts a new object. The object that was live stays as a pending proposal. Shift+click adds a positive point to the live object. A right click or Alt+click adds a negative point and only refines, so with no live object it does nothing. A drag past 4 screen pixels is a box prompt and starts a new object. Backspace removes the last point and then the box, and reruns the model on what is left with no previous logits.
- A box is always the one the user drew. No box is derived from a mask.
- The best of all four candidate masks is chosen by the predicted IoU, for every prompt. Refinement sends the chosen candidate's 256 by 256 logits back through `mask_input`. The output stays the best of four.
- The outline is traced from the decoder's logits at level 0, so its sub-pixel position comes from the logit gradient, then simplified with a tolerance of 0.4 model pixels. When several rings come back, the smallest one that contains the first positive point wins, and the largest ring wins when nothing contains it.
- The patch around the first positive point (or the centre of the box) is read at the nuclei preset and encoded once per patch key. Later points of the same object must lie inside that patch, otherwise they are ignored with a message.
- The tool owns one model run in the document for the lifetime of a session. It is a transient `setDocument` update, not a history entry. Accept and Discard are the history entries. When no piece of the run is pending any more, the session resets and the next gesture starts a new run.
- In the development build with the fake API on, the tool uses a deterministic fake model and reader (a disc around each positive point, cut by negative points, bounded by the box). The Playwright interaction tests run on it and spawn no worker. Everywhere else the worker client and the patch worker are created when the tool is first used and closed with the stage.

## Consequences

- Forty nuclei cost forty clicks and one Enter. Nothing is saved until the user accepts, and the class strip chooses the class at accept time because the run is re-stamped whenever the active class changes.
- The pending outlines of a session are lost on reload, like any proposal.
- A slide smaller than the patch gives a non-square patch. The decoder graph is traced square ([ADR 0246](0246-pathosam-onnx-export-contract.md), the export contract), so the tool refuses it with a message until a new export exists.
- The accuracy smoke test scores thresholded masks, not the traced outlines. The interactive protocol task (MLEVAL-003) has to score the outlines.
