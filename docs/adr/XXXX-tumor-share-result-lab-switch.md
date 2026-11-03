# XXXX. Tumor share result is a lab switch per kind of case

Status: Accepted

## Context

REVIEW-017 (the tumor share result for cellularity cases) shows the POC's doc 33 result in the number line: the tumor share against a cutoff, worded "Above 20% whatever the unsure cells are", "Below 20% whatever the unsure cells are" or "Could be either side of 20%, check the unsure cells". [ADR 0012](0012-ux-round-2-prototype-revisions.md) (UX round 2 revisions) keeps it only for cases that ask for cellularity and turns it off for sentinel nodes, which are staged by deposit size. The task says the switch is per specimen type in lab settings.

The settings catalogue holds scalars (choice, switch, whole number, identifier). A specimen type on a case is free text, so a map from specimen type to switch does not fit it, and the rules that decide the layout of the findings (sentinel node staging against cell cases) already follow the project's class list.

## Decision

- The switch follows the kind of case, which is the project's class list: `sentinel-node` or `pannuke`. Two lab-only switches, `tumor_share_result_sentinel_node` (off by default) and `tumor_share_result_pannuke` (on by default), and one lab-only whole number, `tumor_share_cutoff` (1 to 99, default 20), are added to the catalogue. A case with no classes never shows the result.
- The range is doc 33's expected-mistakes range, ported unchanged: the low end sums the tumor probabilities of the cells called tumor, the high end adds the tumor probabilities of all other cells to the count of tumor calls. Above means the low end is at or over the cutoff, below means the high end is under it, otherwise it is open. Cells the reviewer has checked count as 0 or 1. The cells to check are walked most contested first, assuming each answer confirms the call.
- The logic is a pure function in `packages/ui/src/lib/tumor-share.ts`, and `NumberLine` shows the chip when it is given a result.

## Consequences

- A new kind of case with its own staging needs its own switch key. Moving to a real per specimen type map later means a new catalogue kind and a migration of these three keys.
- The cutoff is one number for the lab. A different cutoff per kind of case is a new key.
- The stored lab values change shape only by adding keys, so no migration is needed.
