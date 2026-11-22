# 0429. The tenant object lock is off until a real user

- Date: 2026-11-22
- Status: Accepted
- Deciders: owner (decision 172), Claude
- Backlog: OPS-009 (storage lifecycle and cost controls), PROTO-150 (upload and model run jobs tell one story)

## Context

OPS-009 put the seven day R2 bucket lock `keep-tenant-objects` on `t/` in every slide bucket, so a mistaken delete or overwrite of a tenant object could be undone. ADR 0420 (a worker leaves a staged upload the bucket lock keeps) then showed what the lock costs while only test data exists. The publish step cannot delete a staged upload, and an upload to a de-identified project fails because the hidden label image cannot be deleted. Decision 172 asked whether such a label may stay for seven days. The owner answered "remove that lock, it is harmful for now".

## Options considered

1. Keep the lock and let the job treat the refused label delete as done, as recommended in decision 172.
2. Destroy the lock resources. Turning the lock back on means writing them again.
3. Keep the lock resources declared and switch their rule off with a module variable `lock_tenant_objects`, default false.

## Decision

Option 3, the owner's answer with the least to undo. The rule `keep-tenant-objects` stays declared on `parfocal-dev-eu` and `parfocal-prod` with `enabled = var.lock_tenant_objects`. The static policy accepts an enabled rule or one switched by that variable, and still refuses a rule disabled by a literal or on another prefix. Applied on 2026-11-22 in the dev and prod roots, 0 added, 1 changed, 0 destroyed each.

## Consequences

- Deletes under `t/` work at once again, so the label image of a de-identified upload is deleted and the upload job ends as done. `ObjectStore.discard_object` from ADR 0420 stays, since it still covers a lock if one comes back.
- A mistaken delete of a tenant object cannot be undone in R2. Only the reseed brings test data back.
- OPS-014 (prepare production for the first real user) must set `lock_tenant_objects = true` before real data arrives.
