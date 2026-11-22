# 0431. The disagreement queue can keep a reviewer's new type

- Date: 2026-11-22
- Status: Accepted
- Deciders: owner (decision 173), Claude
- Backlog: PROTO-161 (the queue keeps a reviewer's new type)

## Context

ADR 0419 (the queue decision rules the final layer over reviewer edits) makes the queue's answer decide the final layer. The queue offers Disagree, which leaves the cell out, and Agree with the AI, which keeps the AI's class. When a reviewer disagreed and retyped a cell, the new type cannot be kept, though a corrected type is the most useful training data.

## Options considered

1. A third answer, "Keep with the reviewer's type", which keeps the outline and the reviewer's type.
2. Keep the two answers.
3. Agree keeps the reviewer's type on its own when a reviewer retyped the cell.

## Decision

Option 1, the owner's answer. The queue shows the third answer only on an object a reviewer retyped. It is a queue decision of its own, so ADR 0419 still holds: the final layer, the frozen dataset and the consensus export keep the outline the queue settled and the reviewer's class, and count the object as edited.

## Consequences

- This amends ADR 0419 with one more queue decision. PROTO-161 builds it with a database test over the final layer.
