# 0151. Agents may write to production under one standing approval from the owner, inside a project budget of $30 a month

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-009 (storage lifecycle and cost controls). Touches OPS-001 (base infrastructure as code), OPS-002 (deploy definitions), OPS-005 (continuous deployment), IAM-001 (login provider setup) and INGEST-028 (upload protocol check on the R2 dev bucket)

## Context

[ADR 0115](0115-production-access-and-spend-caps.md) (production access and spend caps) asks for the owner's yes in chat for every production write, and a yes never carries over. With two agents and several sessions a day, that turned the owner into the bottleneck for every `tofu apply` and deploy. On 2026-11-02 the owner asked to say yes once for all sessions and subagents. In the same answers (decision 26, pilot spend) the owner set the whole project's budget to the $30 a month of compute Modal includes, and asked that nothing runs all the time in production.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep a yes per action (ADR 0115) | Safest | The owner approves every apply by hand, which is what they want to stop |
| A standing yes for every production write | Fastest | One wrong destroy loses data and no one is asked |
| A standing yes for additive writes inside the budget, with the destructive and money-raising actions still asked | Agents deploy alone, and the actions a revert cannot undo stay with the owner | An agent must read every plan before applying it |

## Decision

The third option. This record is the owner's standing yes, and it counts for every session and subagent until the owner withdraws it in chat.

Allowed without asking, in production and everywhere else:

- `tofu apply` when the plan has no destroy and no replace.
- Deploys, migrations that only add, new buckets, DNS records, Zitadel apps and settings, and GitHub secrets and settings that add or change without removing anything.
- Starting on-demand jobs whose cost fits the budget below.

Still asked in chat, one action at a time, with the exact command or plan diff and its cost:

- Anything that deletes, destroys, replaces, purges, force-pushes, rotates or resets, and any migration that drops or rewrites data.
- Raising a spend limit, adding a payment method, changing a plan, accepting terms, or anything that would push the month past the budget.
- Anything that looks wrong, such as an unexpected charge, a resource no agent created, or a plan larger than the agent expected.

The budget is $30 a month for the whole project. Modal keeps its usage limit at $30 and its spend limit at $0, so its included credits are the compute budget. Every other provider stays on its free tier or pay-as-you-go under its alert, with nothing running all the time in production. Production scales to zero when idle, and GPU work runs only on demand. Uploaded originals are kept while their project exists (decision 26a), under the R2 alert.

Every production write is logged in `docs/log.md` with what changed, why and what it cost.

## Consequences

The rest of ADR 0115 stays: reading production is free, caps and alerts stay on every service, and dev and staging come first. OPS-001, OPS-002, IAM-001 and INGEST-028 no longer wait for the owner. The cost estimate of [ADR 0147](0147-cloud-provider-regions-and-pilot-cost.md) (about $140 a month) describes a full pilot, not this budget, so ingest and AI work in the thesis pilot must fit $30 a month, which means few slides and on-demand runs only. `AGENTS.md`, `docs/knowledge/platform.md` and `docs/knowledge/agent-workflow.md` say so.

On 2026-11-13 [ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) added one standing yes: resetting and reseeding production needs no question while it holds only the owner's test data, until staging returns before the first real user. Everything else on the "still asked" list stays asked.
