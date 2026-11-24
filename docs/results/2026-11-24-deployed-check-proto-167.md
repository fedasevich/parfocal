# Result: deployed check of PROTO-167 (round seven slips) on v0.49.0

- Date: 2026-11-24
- Backlog: PROTO-167 (round seven slips from the deployed walk of v0.46.0: the Best chip's steps, the evaluation classes of a cell task and the singular device line)
- Kind: deployed check
- Version: v0.49.0, `/api/status` answered release 5764d7f (the commit `chore(release): v0.49.0`) before the check
- Environment: app.parfocal.eu (a development environment by ADR 0390), headless Chromium through Playwright at 1440 by 900
- Data: the seeded demo workspaces, the accounts agent-walk and role-researcher, no PHI
- GPU calls made: 1 Best embedding of a view (`POST /embeddings/view`, 200). The same click also sent one `POST /embeddings/warm` (204, no body), counted here for honesty. No second run was needed.

## Question

Does each slip of PROTO-167 meet its "Done when" line on the deployed app?

## Method

Sessions came from `scripts/agent_session.py` (agent-walk, and `--role researcher` into two separate `--out` files). Headless Playwright scripts in the scratchpad loaded a saved storage state, read the API through `fetch` inside the signed-in page and sampled the DOM every 250 ms. No screenshot was taken and no code was changed.

## Results

### 1. Smart select Best, the chip steps. Pass

On CMU-1-Small-Region.svs (project Whole-slide format survey, 20x) the script opened the viewer, pressed S, picked Best in the "Model for outlining nuclei" group (`data-tier` best) and clicked the centre of the stage once. The chip (`smart-status`) then read:

| Seconds after the click | data-step | Chip text | Other state |
|---|---|---|---|
| 0.3 | outlining | Outlining | layer phase thinking, encoder not known yet |
| 0.8 | asking-best | Asking Best's GPU (last text seen before the next step: "Asking Best's GPU, 5 s") | encoder asking |
| 6.8 | loading-model | Fetching Best's outline model | encoder preparing, the view POST had answered 200 at 6.8 s |
| 7.8 | none, status found | Outline found | layer phase ready, encoder server, 1 proposal |

The total was 7.8 s from click to proposal. The GPU was warm, so the wait was short: Asking Best's GPU lasted about 6.0 s with a seconds count, Fetching Best's outline model about 1.0 s, and the bare "Outlining" text showed only for the first 0.5 s, before the encoder step was known. The long unlabelled "Outlining" of 35 s from v0.46.0 did not appear. No `gpu-wait` element, no fallback chip and no console error showed. The seconds count shows on the Asking step. The Fetching step was too short here for its count to appear, and a cold GPU or a cold model download was not reached, so a long Fetching step stays unobserved.

### 2. RT-11 evaluation JSON names the cell classes. Pass

RT-11 "Walk preparing check 21:54:39" (task 0ef656e7-d587-4fd7-aa94-ec0132ed515e, in the project Scanner format comparison of role-researcher, 30 random cells) still exists. `GET /api/review-tasks/{task}/evaluation` through the signed-in page answered 200 `application/json`. Its `classes` array held two entries, both of kind cell:

- Immune: 26 true positives, 0 false positives, 0 false negatives, precision 26 of 26, sensitivity 26 of 26.
- Stroma: 3 true positives, 1 false positive, 0 false negatives, precision 3 of 4, sensitivity 3 of 3.

So Stroma has 4 cells and Immune 26, 30 together, the same split the decisions CSV showed on v0.46.0. There is no class "unclassified". The `overall` array carries the all-class cell row (29 true positives, 1 false positive of 30).

### 3. Privacy and session reads the singular line. Pass

With role-researcher signed in twice (two separate `agent_session.py --role researcher` sign ins), `GET /api/auth/sessions` for the first session listed 2 sessions (one `current: true`, one `current: false`, both user agent `parfocal-agent-session`). The page `/settings/privacy` under "Other devices" then read exactly:

"1 other device is signed in: an unnamed client."

followed by the "Sign out on other devices" button. On v0.46.0 the same line read "1 other devices are signed in".

## Interpretation

All three slips meet their "Done when" line on v0.49.0. The Best chip names each step with a seconds count while it waits, RT-11's evaluation lists Immune and Stroma, and one other session reads in the singular. The Best check ran with a warm GPU (7.8 s in all), so it shows the steps but not a slow cold wait.

## Follow-ups

None new. What the check left in the dev app: two role-researcher sessions and one extra agent-walk session, which expire by themselves, and no new task, annotation or proposal (the Best outline proposal was not saved).
