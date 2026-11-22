# 0432. Drawn objects are reviewed from a hidden snapshot

- Date: 2026-11-22
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-160 (a review task takes drawn and one click objects)

## Context

[ADR 0430](0430-a-review-task-takes-drawn-and-one-click-objects.md) (a review task takes objects drawn by hand or with one click tools) says the review stage, the disagreement queue, the final layer and the dataset treat drawn objects like AI objects. It does not say how they reach those readers. Each of them reads a review task slide's pinned result set from `result_objects`. Drawn outlines live in `annotations`, which keep changing after a task starts, and the server did not know which tool drew a shape.

## Options considered

- Read the slide's `annotations` live in every reader. No copy is made, but the review order, the claims, the queue, the final layer and the export would each need a second branch, and an outline edited or deleted after the task started would move under reviewers' decisions.
- Ask the researcher to save the shapes as a result set first. ADR 0430 turned this down as option 3.
- Copy the slide's drawn outlines into a result set with source `drawn` when the task is created and pin it like an AI result set. It is hidden from every listing, so nobody can pick it or see it as AI.

## Decision

- Migration 0158 allows `drawn` as a result set source, adds `drawn_by_user_id` and `tool` to `result_objects`, and adds `tool` (`hand` or `smart-select`) to `annotations`. The viewer sends the tool when it saves an outline, and shapes saved before this have no tool.
- A review task draft names `drawn_slide_ids`. Creating the task copies each named slide's region outlines that belong to no task and are not deleted, keeping their numbers, classes, authors and tools, and pins the copy. A named slide with no drawn outline refuses the task with `no-result-set`. An annotate task takes no drawn objects.
- The project result set lists, the slide result set list, the project overview and a slide's `result_set_ids` leave drawn copies out. A project slide carries `drawn_count`, and the wizard offers "Drawn and Smart select outlines" beside the AI result sets.
- Object codes in task paths stay plain, such as `T7`, so decisions, the queue and edits keep their keys. Review objects and queue rows carry `drawn`, and review objects also carry `drawn_by_user_id` and `tool`. The review card shows `T7⁺` and says who drew it with which tool, not an AI certainty.
- The final layer stores `person`, `drawn_by` and `tool` for a drawn object. The dataset gives it the ID `T7+` and the properties `drawn_by` and `tool`.

## Consequences

- A review checks the outlines as they were when the task was created. Later edits to the slide's outlines do not reach the task.
- Drawn cells and points are not copied, because AI cells live in stored chunks, not in `result_objects`. A follow-up can add them when a cell chunk writer exists in the API.
