# 0390. app.parfocal.eu is a development environment until the owner says it is production

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-014 (prepare production for the first real user) ends this record. Changes [ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) and [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month).

## Context

On 2026-11-17 the owner wrote that `https://app.parfocal.eu` is a development environment that only runs in the browser, that nothing real happens there, and that agents must be able to sign in there, do anything and change anything, because it can be reseeded quickly. The deployed app holds only the owner's test data and is far from ready for real users. Asking before each change there slowed every click-through without protecting anything.

## Options

1. Keep treating the deployed app as production under ADR 0151 and ADR 0293. Every change of its data or settings stays a question.
2. Treat the deployed app as a development environment until the owner says otherwise, and keep the money guard. Agents work there freely, and only spend and the cloud accounts themselves stay asked.

## Decision

Option 2, on the owner's order of 2026-11-17.

- The deployed app at `app.parfocal.eu`, its Neon database, its Zitadel instance and its slide bucket are a development environment. It stays one until the owner writes in chat that it is production and someone really uses it. Only that sentence ends this record.
- Agents may sign in there with their own test accounts, create and delete test users in the Zitadel organisation, change any workspace, project, member or setting inside the app, run any migration, and reset and reseed the database and the app's tenant prefix `t/` in the bucket, all without asking. Each reset and each new test account is logged in `docs/log.md`.
- Still asked in chat, one at a time: anything that raises spend or touches billing, plans, limits or payment, and deleting or replacing a cloud resource that a reseed does not bring back, such as a bucket, the Neon project, a DNS record, the Zitadel instance or a login app, a GitHub environment or ruleset. The $30 a month budget stands. Fixture slides under `fixtures/` and in the bucket outside `t/` are never deleted.
- The words "production" and "prod" in older records and scripts name this deployment. They do not mean real data until the owner's sentence.

## Consequences

Click-throughs, seeding and fixes on the deployed app need no owner approval. No PHI or real patient data goes into it, the same as everywhere. Before the first real user, OPS-014 brings back a separate environment and this record ends.
