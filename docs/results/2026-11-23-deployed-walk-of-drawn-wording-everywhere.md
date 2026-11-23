# Deployed walk of drawn wording everywhere on v0.39.0

Walked on 2026-11-23 on app.parfocal.eu after /api/status named release 9b5a537 (v0.39.0), which carries PROTO-164 (every opinion form and screen reads as drawn on a drawn task). The dev app had just been reseeded. Only the agent test account agent-walk was used, through headless Playwright scripts with the saved session and a few API calls with its cookies. No password was typed, no screenshot was taken, no code was changed and nothing was spent.

What the walk left behind: the seeded adjudication of T1 on RT-4 (Drawn outline review example) is decided as Disagree, and a new task RT-10 (Review of drawn outlines) on the slide "Case drawn outlines" in P01 (Sentinel node metastasis study) has the agent's first read recorded. RT-10 was created through the API, not the wizard, because the wizard picks all 14 loose slides of P01 by default and none of them has drawn outlines, so the drawn source cannot be sent without first changing the slide pick. The wizard did name the task "Review of drawn outlines" when the drawn source was picked.

## 1. The adjudicator. Pass

The agent's adjudication page of RT-4 reads "Ada asked you to decide", "One reviewer disagrees with the drawn outline, the other agrees with the drawn outline" and "A person drew T1⁺ as tumor.", then Reviewer A "Disagree · boundary is off" and Reviewer B "Agree". No line on the page has the word AI, a score or "% sure". Disagree saved with 200 and the page then read "All 1 decided. Ada is told."

## 2. A new drawn review task. Partly fails

- First read panel. Pass. It reads "Read the slide without the drawn outlines" and "The drawn outlines are hidden until you record your first read.", ends with "After this the drawn outlines appear and you can give your decisions.", and has no AI line. Recording answered 200. The separate first read notice (The drawn outlines stay hidden until your first read) did not show in the guided or the full viewer, because both showed the first read panel instead, so it was not seen.
- Guided coach tip after the first read. Fails. Right after Record my first read, the guided view showed the coach tip "The AI found this. It is outlined in white." The code picks the drawn tip only when the current object is known to be drawn, so the object was probably not loaded yet when the tip drew.
- Viewer's object box. Pass, with a slip. In the full viewer the box is titled "Drawn outlines" and "AI says" does not show. The box still names the hidden snapshot as "Result set Tumour MONAI tumour detection 0.6.4, ONNX", which is a model the drawn outlines did not come from, and every object row shows a score of 0.00.
- Display tab. Fails. In both the full viewer and the guided view the tab reads "What the AI shows" and "AI order · fit · moves on by itself", not "What the layers show" and "Drawing order". The task detail API answers drawn true for RT-10, so the Display tab on the deployed app does not get the flag, though the code in apps/web/src/screens/viewer/use-viewer-panels.tsx passes it.
- Task settings. Pass. The Settings for RT-10 drawer reads "A redraw is compared with the drawn outline when the other reviewer kept it." and has no AI line.
- Opinion form. Pass. The reviewer's Opinion tab asks "1 · Are the drawn outlines acceptable for this slide?" and "3 · Would you sign this without changes?", with no AI line.

## 3. An AI review task still reads as AI. Pass

The settings of RT-5 (Certainty decisions review) read "4 and 5 count as agree with the AI", and those of RT-6 (Agree decisions review) read "Agree with the AI". Both say "A redraw is compared with the AI outline". The queue of RT-3 (Disagreement queue example) filters by "Both vs AI" and its Decide panel reads "Agree keeps the AI's call". Its evaluation report prints Sensitivity, Precision and Dice for regions.

## Recheck on v0.39.1

Rechecked on 2026-11-23 on app.parfocal.eu after /api/status named release 5d0457a (v0.39.1). RT-10 still existed. Because its first read was already recorded, a second drawn task, RT-11 (Review of drawn outlines), was made through the API on the same slide with the first read hidden. No screenshot was taken, no code was changed and nothing was spent.

- Display tab. Pass. On RT-10 the full viewer's Display tab reads "What the layers show" and "Drawing order · fit · moves on by itself", and the guided view's Display tab reads "Drawing order · fit · moves on by itself". Neither has a line with the word AI.
- Coach tip after a first read. Pass on wording, not seen. Recording the first read of RT-11 in the guided view answered 200, and no line on the page after it had the word AI. No coach tip showed at all this time, so its drawn wording (A person drew this) was not seen. The tip probably shows only once per person, and the agent saw it on RT-10 in the first walk.
- Drawn outlines box. Pass. In the full viewer of RT-10 the box reads "Drawn outlines", then "Drawn by" and "Ada Admin with Smart select, Ada Admin by hand". It names no result set, and the rows T2 and T1 show only their type, state and size, with no score.
- Coach tip text. Pass. The coach remembers it was seen in the server's personal settings of the signed-in user (hints_seen with the id coach.guided, in apps/web/src/hints/hints-seen.ts), and browser localStorage holds it only for a guest, so no key was cleared and no server setting was changed. On a third drawn task, RT-12, made through the API, the first read was recorded in guided review, and on the next open of the guided view the coach showed by itself with the canvas tip "A person drew this. It is outlined in white." and the panel tips about the answer keys and "Add something the outlines missed", with no line with the word AI.
