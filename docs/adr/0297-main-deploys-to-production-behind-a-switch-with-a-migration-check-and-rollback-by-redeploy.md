# 0297. Main deploys to production behind a switch, destructive migrations need the owner's named yes, and rollback is a redeploy of older code

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval)
- Backlog: OPS-005 (continuous deployment). Unblocks SKEL-009 (CI deploys main to production). Fills in the "Staging and production pipeline" part of [ADR 0050](0050-deploy-pipeline-and-previews.md) (deploy pipeline and previews) and replaces the vendor rollback that record named, for the time [ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) covers.

## Context

Production is the only cloud environment. Until now a deploy was started by hand from a release tag. OPS-005 (continuous deployment) asks for three things: `main` reaches production without a hand, a migration cannot silently lose data, and a bad release can be taken back.

Facts that shape the choices.

| Fact | Source |
|---|---|
| The owner pushes to `main` with admin bypass of the `ci-ok` rule, so a commit on `main` is not proof that CI passed | [knowledge/agent-tooling.md](../knowledge/agent-tooling.md) |
| AGENTS.md lets agents run migrations that only add, and asks the owner before any migration that drops data | [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month) |
| `alembic upgrade head` from older code fails when the database is at a revision that code does not have | Alembic's `Can't locate revision identified by` error. Not rerun for this record |
| `modal app rollback` and `wrangler rollback` both exist in the installed CLIs | `--help` of both, read locally on 2026-11-13 |
| A job-level `if` and the workflow `concurrency` key can read repository variables through `vars`, and cannot read variables scoped to an environment | actionlint 1.7 passed `deploy.yml` on 2026-11-13, and it checks which contexts each key may use |
| After a deploy, warm Modal containers can keep answering with the old code for minutes | [knowledge/platform.md](../knowledge/platform.md) |

## Options considered

### What starts a production deploy

1. A `push` trigger on `main` in `deploy.yml`. Simple, but it runs beside CI and deploys commits that CI then fails.
2. A `workflow_run` trigger that fires when the `ci` workflow completes, filtered to a successful run for a push to `main`. The deploy checks out the commit CI tested.
3. A last job in `ci.yml` that calls `deploy.yml`. It can reuse the path filter of CI, but it puts production secrets into the CI workflow and makes every CI run on `main` look cancelled when a newer deploy replaces a waiting one.

### How a destructive migration is let through

1. A marker inside the migration file. The agent that writes the migration would also write the marker, so it records nothing about the owner.
2. A list of revisions passed at deploy time, which only a deploy started by hand can carry. The automatic path can never run a destructive migration.
3. No check, and trust review. This is what existed.

### How a release is taken back

1. Vendor rollback: `modal app rollback` for the API and `wrangler rollback` for the Worker. Fast, but two commands with two version numbering schemes, nothing rebuilds the web assets with the matching API address, and TODO: it is not confirmed that Modal offers rollback on the Starter plan.
2. Redeploy an earlier commit through the same workflow, without running migrations. Slower by a few minutes, one path for all three parts, and it works on any plan.
3. Downgrade the database with `alembic downgrade` as part of rollback. Downgrades drop the columns and tables the newer code filled, which is data loss.

## Decision

Option 2 in all three groups.

### Main to production

`deploy.yml` gains a `workflow_run` trigger on the `ci` workflow. The job runs only when the repository variable `DEPLOY_ON_MAIN` is `true` and the CI run was a successful push to `main`. The variable does not exist yet, so merging this change deploys nothing. The owner turns it on with `gh variable set DEPLOY_ON_MAIN --body true`, at repository level, because the gate is read before the job enters the `production` environment.

- The job checks out the commit of the CI run, never the tip of the branch at trigger time.
- The deploy script gets `--only-head-of main` on this path. When `main` has moved on since CI started, the script says so and stops with success, because the newer commit's own CI run will deploy. This also stops a rerun of an old CI run from putting old code over new.
- The concurrency group stays `deploy-production`, shared with the reset workflow, with no cancelling of a running deploy. While the switch is off, automatic runs take a group of their own so they cannot cancel a waiting hand-started deploy.
- `gh workflow run deploy.yml --ref vX.Y.Z -f environment=production` keeps working and ignores the switch.
- The run title is `deploy <commit>` or `rollback <ref>`, so `gh run list --workflow deploy.yml` reads as the release history. A run that stopped because a newer commit replaced it is also green, and its log says that nothing was run.

Every green push to `main` deploys, including one that only changes documents. A deploy of unchanged code costs GitHub minutes on a public repository and no Modal compute. A path filter is a later step, see the triggers.

### Migration safety check

Before `alembic upgrade head`, the deploy reads the revision the database is at and checks every revision file after it (`parfocal_deploy.migrations`). It reads the files as syntax trees and runs none of their code. A revision is destructive when anything outside its `downgrade` function does one of these.

- Calls `drop_table`, `drop_column` or `rename_table`, on `op` or on a batch object.
- Calls `alter_column` with `type_` or `new_column_name`.
- Holds a string with `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `DROP DATABASE`, `TRUNCATE`, `DELETE FROM`, `RENAME TO`, `RENAME COLUMN` or `ALTER COLUMN ... TYPE`. Strings are read wherever they sit in the file, so SQL kept in a constant or an f-string is seen.

A destructive revision stops the deploy before anything runs, with a message that names the revision and what was found. It runs only when its number is passed in `allow_destructive`, an input that exists only on a deploy started by hand. That input is the owner's yes, and it is kept in the run's record.

Renames and type changes count although they lose no rows, because the previous release stops working on the new schema, and rollback depends on it working. Dropping an index, a constraint or a policy, tightening `nullable` and plain `UPDATE` statements are not flagged. The check is a seatbelt and not a proof. It misses `ALTER TABLE t DROP c` written without the word `COLUMN`, a delete built from a table object such as `op.execute(table.delete())`, and SQL built at run time from parts that hold none of the words above. Review still owns those cases.

A database with no `alembic_version` table has nothing to lose and passes. A database at a revision the code does not have is refused with a message that says to deploy that code only as a rollback. A history with two heads is refused.

### Rollback

Rollback puts back older code and never touches the database: `gh workflow run deploy.yml -f rollback_to=<commit or tag>`. The workflow checks out that ref and runs its deploy script with `--skip-migrations`, which skips the check, the Neon calls and Alembic, then deploys Modal, builds the web app, deploys the Worker and runs the smoke check.

This is safe only because migrations on the automatic path are expand-only, which the check enforces. Five limits follow.

- A rollback does not hold while `DEPLOY_ON_MAIN` is `true`. The bad commit is still the head of `main`, so the next green push deploys it again, and an automatic run can cancel a rollback that is still waiting. Turn the switch off first and on again only after the fix is on `main`.
- TODO: redeploying an older ref across a new Durable Object migration tag in `apps/edge/wrangler.jsonc` is untested.
- Do not roll back to a commit older than a destructive migration that already ran. The old code would meet a schema it cannot use. That case is a restore, which belongs to OPS-008 (backups and disaster recovery).
- A ref from before this change does not know `--skip-migrations`. Its script stops on the unknown flag before it does anything, so the oldest rollback target is the commit that lands this record.
- The smoke check proves the app answers, not which version answers. After a rollback, stop leftover Modal containers as [knowledge/platform.md](../knowledge/platform.md) describes.

## Consequences

- SKEL-009 (CI deploys main to production) needs only the variable turned on and one watched run.
- OPS-005 (continuous deployment) is done when a rollback drill on production succeeds. The drill steps are in [knowledge/deploy.md](../knowledge/deploy.md). It was not run with this change, because nothing was deployed.
- A destructive migration merged to `main` blocks every automatic deploy until the owner starts one by hand with its number. That is loud on purpose.
- Contract migrations, the second half of expand then contract, ship in a later release than the code that stops using the column, and always by hand.
- When staging returns with OPS-014 (bring back staging before the first real user), `main` goes to staging through this same path and production goes back to tags with approval, as ADR 0050 planned.

### Triggers that reopen this decision

| Trigger | Action |
|---|---|
| Deploys of document-only commits become a nuisance, or cause container churn | Skip the deploy when no path under `apps`, `packages`, `workers` or the lock files changed since the last deployed commit |
| A rollback has to finish in under a minute | Confirm the Modal plan allows `modal app rollback`, then add the vendor rollback as a first, faster step |
| A destructive statement gets past the check | Add its shape to the check and a test, or move the check to a throwaway Neon branch that runs the migration for real |
| A second committer joins | Require a reviewer on the `production` environment for runs that carry `allow_destructive` |
