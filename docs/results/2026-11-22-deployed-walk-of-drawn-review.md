# Deployed walk of drawn object review on v0.37.0

Walked on 2026-11-22 between about 21:15 and 21:30 on app.parfocal.eu. /api/status named release 4d4e4cf (v0.37.0). The walk checked three backlog tasks: PROTO-162 (a drawn outline takes its kind letter and a person mark), PROTO-160 (a review task takes drawn and one click objects) and PROTO-161 (the queue keeps a reviewer's new type).

Only the agent test account agent-walk was used, in the workspace ČVUT Biomedical Engineering and the project P04 (Walk v0.35.12 training path), where it is the only member and the owner. The account played both the researcher and the single reviewer. The browser steps ran as headless Playwright scripts with the saved session. No password was typed into a page. Signing needs a sign-in from the last 5 minutes, so the session was refreshed once with scripts/agent_session.py just before the signature. No GPU or model call was started and nothing was spent. No code was changed.

What the walk left behind in the dev app: two new drawn regions on Slide 1 of P04 (T2⁺ drawn in the viewer, T3⁺ saved through the API with the Smart select tool), the review task RT-2 (Review of PathoSAM + HoVer-NeXt v1.2, really a review of drawn objects) with its decisions, queue decisions, Evaluation v1 signature and final layer build 1, and one task email to the agent's own address.

## PROTO-162, the kind letter and person mark. Pass

A Tumor polygon was drawn in the viewer with the polygon tool and Tumor picked by key 1. The save answered 201 with code T2+ and the Tumor class. After a reload the Objects tab listed, under "Drawn shapes and measurements 2" and "Tumor 2", the rows T1⁺ and T2⁺ with their areas and perimeters. No row was named M. The guided review card later named the same objects T1⁺, T2⁺ and T3⁺, and the queue rows showed T2⁺ and T3⁺.

## PROTO-160, a review task from drawn objects. Pass

The new task wizard on P04 offered a third source, "Drawn and Smart select outlines", described as outlines people drew by hand or with Smart select on 1 slide. Picking it changed the slide line to "1 slide picked, all with drawn outlines" and switched the study template to Detection study v1. The reviewer Agent Tester was picked, the decision question was set to Agree with the AI, and Create and notify 1 reviewer sent POST /review-tasks with result_sets empty and drawn_slide_ids equal to slide_ids. It answered 201 and created RT-2.

The reviewer's objects call listed T1, T2 and T3, all drawn, all Tumor, drawn by the agent, with the tools none, hand and smart-select. In guided review the card said "A person drew T1⁺ as tumor." T1 got Agree, T2 got Disagree, and T3 got Disagree, then Redraw the outline with four clicks and Finish outline, then Change the type to Stroma. Each saved with 200, the redraw and retype as PUT edits/T3 with the Stroma class. The opinion form's one required question was answered through the API, because the form is not what this walk checks, and Submit then answered 200.

The queue held T2 and T3. After the queue decisions below, the sign-off page read "Drawn objects, 3 objects, plus 0 added by a reviewer" and signing answered 200. The dataset answer shows final layer build 1, current, with 1 confirmed, 1 edited and 1 rejected. The training dataset archive holds T1+ as Tumor (origin ai-confirmed) and T3+ as Stroma (origin ai-edited, tool smart-select), and T2 is left out.

## PROTO-161, the queue keeps a reviewer's new type. Pass

The queue row of T3 showed "retyped to Stroma", and the Decide panel offered "Keep with the reviewer's type" with the note that it keeps the settled outline, or else the original, with the reviewer's type and counts T3 as edited. The panel for T2, which was not retyped, did not offer it. Clicking it sent POST disagreement-queue/.../T3 with action keep-type and raw Stroma, which answered 200. The button then left the panel, and the decided T3 read "Kept with the reviewer's type, Stroma". T2 was answered Disagree in the queue. After signing, T3 is in the final layer and the training dataset as Stroma, class key 2, counted as edited. Its outline is the original drawn one, not the reviewer's redraw, because the redraw was not picked with Use this outline before keeping the type. That matches the note on the panel.

## Slips seen

- The wizard keeps the default task name "Review of PathoSAM + HoVer-NeXt v1.2" after the source is switched to drawn outlines, so the task is named after a model it does not review.
- The queue's Decide panel speaks of the AI for drawn objects. It reads "the reviewer vs AI" and "Agree keeps the AI's call", and the queue answer carries an AI class Tumor with score 0.0. The default 5-point question of Detection study v1 also opens with "The AI's claim". The guided card itself correctly says a person drew the outline.
- The training export marks drawn objects with the origins ai-confirmed and ai-edited. The API test of PROTO-160 expects this, so it may be meant, but a reader of the export cannot tell a drawn object from an AI one by origin alone.
- The sign-off page shows Sensitivity 1.00, Precision 0.33 and Dice 0.26 for regions on a task with no AI result. TODO: decide whether these numbers mean anything for drawn objects.
