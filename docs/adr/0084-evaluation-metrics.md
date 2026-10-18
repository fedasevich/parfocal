# 0084. Evaluation metrics count AI objects against the reviewers' consensus, with kappa between reviewers

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: EVAL-000, EVAL-001, EVAL-002, EVAL-003, ADJ-002, ADJ-006

## Context

EVAL-000 must define the metrics of the evaluation report: sensitivity, precision and Dice for regions against the consensus, Cohen's kappa between reviewers and cell agreement, and confirm the PDF choice. POC doc 37 says the report compares the AI with the reviewers (sensitivity, precision, Dice for regions), gives inter-rater kappa, breaks errors down by reason, sums up the opinion forms and lists every object by ID. The inputs exist now: one verdict per task, reviewer, slide and object ([ADR 0072](0072-verdicts-reasons-and-opinion-forms.md)), each reviewer's reviewed layer with retypes, reshapes, deletes and added objects ([ADR 0079](0079-reviewed-layer.md)), and the disagreement queue with its rule ([ADR 0080](0080-disagreement-rule-and-sign-off.md)). Decisions on queued objects are part of ADJ-002, which is mostly a screen. The PDF engine is Typst ([ADR 0083](0083-typst-for-report-pdfs.md)).

## Options considered

1. Score each reviewer against the AI and average. Simple, but the report would have no single answer per object, and the queue and its decisions would not count.
2. Build one consensus answer per object (unanimous verdicts, else the decision on the queued object), score the AI against it, and measure agreement between reviewers separately. Matches doc 37 and uses the adjudication the product already has.
3. Fit a latent truth model (Dawid and Skene). Better with many reviewers, but hard to explain in a report for doctors and unstable with two or three reviewers.

## Decision

Option 2, with these definitions. The engine (EVAL-001) is a pure function over stored rows and a fixture task with hand-computed values tests it.

- The consensus of a judged AI object is its reviewers' verdict when they all agree, or the decision on it when it was queued: "keep the AI's call" counts as agree, "go with the reviewers" as disagree. A queued object without a decision is left out and counted as undecided, and a signed-off task has none ([ADR 0080](0080-disagreement-rule-and-sign-off.md)). An object whose consensus is `unsure` is left out of sensitivity and precision and counted as unsure.
- For the AI's class C on a slide: true positives are AI objects of class C with consensus agree. False positives are AI objects of class C with consensus disagree, including `wrong_class`. False negatives are objects the reviewers added as class C (T⁺ or C⁺ in the reviewed layers, counted once per object when reviewers added overlapping objects, matched with the [ADR 0071](0071-object-id-grammar.md) thresholds), plus AI objects of another class that the consensus retyped to C. Precision is TP / (TP + FP) and sensitivity TP / (TP + FN), per class and over all classes, for regions and for cells separately.
- Dice for regions is computed per slide between the union of the AI's regions of a class and the union of the consensus regions of that class: AI regions with consensus agree, reshaped where a reviewer reshaped them (the outline of the first reviewer in task order when several did), plus added regions. Deleted and disagreed regions are not in the consensus. It is reported per class, and the report's headline is the mean over slides.
- Cohen's kappa is computed for each pair of reviewers on the objects both judged, with the three categories agree, disagree and unsure. The report gives each pair and the mean. With exactly two reviewers that is the classic Cohen's kappa. Fleiss' kappa is added when a task has more than two reviewers on the same objects.
- Cell agreement is the share of judged cells whose consensus is agree, and the share of cells on which every reviewer gave the same verdict.
- Errors are broken down by the reasons of the disagreeing verdicts, and opinion answers are summed per question (mean and spread for scales, counts for choices and yes or no, and the text answers listed).
- Every number carries the count it was computed from, and a metric whose denominator is 0 is reported as not available, not as 0.
- The PDF is rendered with Typst ([ADR 0083](0083-typst-for-report-pdfs.md)).

## Consequences

- The decisions API is split out of ADJ-002 into ADJ-006 (decisions on queued objects), because EVAL-001 needs decisions and no backend task may depend on a screen. ADJ-002 keeps the queue screen and depends on ADJ-006, and EVAL-001 now depends on ADJ-006 instead of ADJ-002.
- EVAL-001 computes the metrics above, EVAL-002 shows them with their counts, and EVAL-003 exports them.
- TODO: confirm with the first real task that reviewers rarely reshape the same region, since only the first reviewer's outline enters the Dice consensus.
