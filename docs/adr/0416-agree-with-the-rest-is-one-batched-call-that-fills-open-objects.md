# 0416. Agree with the rest is one batched call that fills open objects

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-143 (Agree with the rest holds at 200 cells and a failed submit says so)

## Context

The deployed walkthrough of v0.34.1 found that Agree with the rest on 200 sampled cells sent one `PUT /decisions/{object}` per cell at the same moment. Each call holds a pooled database connection for its whole transaction, and for a cell that transaction also reads every result chunk from object storage to check the cell is in the result set. The pool is 10 plus 30 overflow, so the calls past it waited for a connection, timed out and answered 500, and every other call of the API waited behind them for about a minute. This cause is inferred from the code, not read from the deployed logs. Undo had the same shape, one `DELETE` per cell.

## Options considered

- Send the single calls a few at a time from the client. No API change, but 1,000 cells still cost 1,000 transactions and chunk scans, and the pool is still shared with every other call while it runs.
- A larger pool. It moves the limit, and Neon's connection cap and the scan per cell stay.
- One batched call that saves every object in one transaction, with one lock query, one chunk scan, one multi row insert and one audit insert.

## Decision

- `POST /api/review-tasks/{task}/slides/{slide}/decisions/batch` (`saveDecisionBatch`) takes up to 5,000 decisions with the answer, the class picked and the AI call shown, and no reasons or notes. It fills only objects this reviewer has not decided yet, with `ON CONFLICT DO NOTHING`, leaves decided objects as they are and returns the decisions it saved. One unknown object refuses the whole call.
- `POST .../decisions/batch-clear` (`clearDecisionBatch`) clears up to 5,000 decisions in one transaction and is what Undo calls.
- Both take the same advisory lock keys as the single calls, in sorted order, so a batch and a single save of the same object still wait for each other.
- Each saved or cleared object still writes its own `review.object-decided` or `review.object-decision-cleared` audit event, with `batch` set in the details, so counts and reports that read the audit trail are unchanged. No new action and no migration.
- The screens send the batch, show "N cells marked agree" with Undo only after the server confirms, and on a failure take the optimistic answers back and say how many cells were not saved.

## Consequences

- Agreeing with 1,000 cells is one request and one transaction. The DB test bounds it at 5 seconds and takes about one second locally.
- A batch never overwrites a decision, so a stale screen cannot replace a disagree with an agree.
- The single calls stay for every other answer, because they carry reasons, notes and retypes.
