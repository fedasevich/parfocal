# 0430. A review task takes objects drawn by hand or with one click tools

- Date: 2026-11-22
- Status: Accepted
- Deciders: owner (decision 171), Claude
- Backlog: PROTO-160 (a review task takes drawn and one click objects)

## Context

A review task takes only AI result sets, so the task wizard greys out a slide whose shapes were drawn by hand or with Smart select, with the single word "no". The owner's path is to annotate by hand or with one click tools and then have a second person review it. Decision 171 asked whether a review task may take those objects.

## Options considered

1. A review task accepts drawn and one click objects like AI objects, so a second expert can agree, disagree or fix them.
2. The annotate task with its second expert check is the review, and the wizard only says so.
3. The shapes must first be saved as a result set, then reviewed like AI.

## Decision

Option 1, the owner's answer. The wizard lists a slide's drawn and one click objects as a source beside its AI result sets. The review stage, the queue, the final layer and the dataset treat them like AI objects, and each object keeps who drew it and with which tool, so a report can tell a person's outline from a model's.

## Consequences

- PROTO-160 builds it. Decision 174 (which ID a drawn outline gets) gives these objects their kind letter with a person mark, so a reviewer sees T7⁺ and not M1.
- Training data from a reviewed drawn object counts as checked by a person under decision 170 (which objects go into a dataset).
