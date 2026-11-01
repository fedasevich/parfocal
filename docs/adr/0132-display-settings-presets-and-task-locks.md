# 0132. Display settings sit in one panel with four groups, a task sets their defaults and may lock some with a reason, and every decision records the preset in force

- Date: 2026-11-01
- Status: Proposed
- Deciders: Yurii Fedas, in round 6 of the POC mock (POC doc 44, the round 6 working mock), written up by Claude
- Backlog: TASK-011 (display defaults, locks and presets), VIZ-007 (Display panel), changes TASK-004 (blinding and first read), PROJ-008 (project settings), EVAL-007 (study template model and API), VIZ-000 (research check for layers and visualization), VIZ-001 (result sets in the Display panel), VIZ-002 (how objects draw), VIZ-003 (heatmap, density and confidence maps), VIZ-004 (diff and agreement), VIZ-005 (swipe and side by side) and VIZ-006 (object table and stats)

## Context

How objects draw changes what a reviewer decides. A heatmap at full strength, a confidence number or a score cutoff that hides weak objects all steer the eye. The VIZ tasks put these controls in a Layers tab of the full viewer, guided review had a Display button of its own in the top bar, and nothing said whether a study may fix a setting for everyone or how a reader of the report would know what each reviewer saw. Round 6 of the POC mock (POC doc 44) moved every setting into one Display panel and let the task fix some of them.

## Options considered

1. Settings are personal and never recorded. The simplest, but two reviewers may see different things and the report cannot say so.
2. The task fixes every setting. Every reviewer sees the same, but reviewers lose outline width, opacity and zoom, which only help them see.
3. The task sets defaults, may lock the settings that change what the AI shows or the order of objects, each lock with a reason the reviewer reads, and every decision records which preset was in force. Reviewers keep what only helps them see, and the report can say what each reviewer used.

## Decision

Option 3, as the owner built it in round 6 of the mock.

- The Display panel has four groups. How objects draw holds draw as outline, fill or dots, width 1 to 3, opacity 20 to 100, colour by class, score or decision, and ID labels. What the AI shows holds confidence as a number, a word, a colour or hidden, the heatmap from off to 100, the score cutoff and the other result sets. How the review moves holds the order (AI order, largest first, least sure first, random seeded per reviewer and slide), the zoom around the object (fit, tight or context), moving on by itself and where the buttons sit. Presets sit at the top. In the full viewer a View group under them keeps the comparison views.
- The same panel is the Display tab of the full viewer's side panel and of guided review's right column. Guided review's top bar has no Display button.
- The study template presets the task's display defaults, and the New review task flow can change them. The task may lock confidence, the heatmap, the score cutoff, the other result sets and the order. Each lock needs a reason of 5 to 120 characters. A locked control shows the current value as dim text with a lock icon and the reason, as in "Locked by RT-14: confidence hidden this round", and does not respond. The API refuses a reviewer's change to a locked value.
- A reviewer saves presets with a name of 1 to 40 characters, unique among their presets, for this task or for all their tasks. Shift+1 is always the task default and Shift+2 to Shift+4 are the first three saved presets. Every change shows an Undo. A preset that would change a locked value keeps the lock.
- Every decision stores the preset in force, the task default or a preset's name. The Objects tab, the object table and the report's worst objects block show a Preset column when anyone used a preset, and the report's Methods block names the defaults and who used which preset on how many objects.
- The score cutoff no longer hides objects. Objects below it draw dashed at half opacity and stay in scope, because the task fixes the scope and Display only changes how things draw.

## Consequences

- TASK-011 (display defaults, locks and presets) is new for the API, and VIZ-007 (Display panel) is new for the panel.
- TASK-004 (blinding and first read) and EVAL-007 (study template model and API) are ticked, so each gains a line pointing at TASK-011. PROJ-008 (project settings) gains the display defaults of the default study template.
- VIZ-001, VIZ-002, VIZ-003 and VIZ-006 follow the panel. VIZ-004 and VIZ-005 sit in its View group. VIZ-000 records how the panel's state reaches the overlay system.
- The decision row gains the preset, which GUIDE-015 (decision styles with the raw answer and Counts as) and TASK-011 add together.
