# 0073. Audit queries for admins, and exports signed with an Ed25519 key derived per workspace from the master key

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: SEC-024 (audit log queries and signed export), closes the signed export TODO in [ADR 0027](0027-audit-log-hash-chain-in-postgres.md), touches SEC-007 (access and erasure requests) and SEC-006 (retention)

## Context

[ADR 0027](0027-audit-log-hash-chain-in-postgres.md) keeps the audit log as a hash chain per workspace, and notes that an owner of the database could still rewrite the table and recompute every hash, so SEC-024's signed export should close that gap. SEC-024 asks for queries by person, patient, case, kind of action and dates, and for an export that lists every matching entry with emergency access and its reason marked, for a patient's access request or an inspection. The backlog text says leads see their department, but leads and departments are gone. Only admins hold `audit-log` ([ADR 0061](0061-researcher-reviewer-and-admin-roles.md)), and emergency access is per clinical project ([ADR 0066](0066-emergency-access-per-clinical-project.md)).

## Options considered

### The signing key

1. A new secret, an Ed25519 private key in the settings. Clear, but every environment, CI and preview needs it before the API starts, and it is one more secret to rotate.
2. A key derived with HKDF-SHA256 from the current master key that already protects the workspace data keys ([ADR 0033](0033-envelope-encryption-with-tenant-data-keys.md)), with the workspace id in the HKDF context. Nothing new to provision, each workspace gets its own key, and rotating the master key rotates the signing key while older master keys still verify older exports.
3. An external timestamping or transparency service. The strongest anchor, but a cloud dependency the pilot does not have yet.

## Decision

Option 2.

- `GET /api/tenant/audit-events` (`listAuditEvents`) takes `person` (a user id, matched as actor or as the person targeted), `patient_id` (events on that patient's cases, and emergency access to the patient's project), `case_id`, `project_id`, `target_type` and `target_id`, `action` (one or more), `action_prefix`, and `since` and `until` on the event time.
- `GET /api/tenant/audit-events/export` (`exportAuditEvents`) takes the same filters and returns a `parfocal-audit-export` version 1 document. It holds the workspace id, the time, the filters, the chain head (sequence and hash), every matching event with its hashes, and on each event `emergency` and the `reason` when it is emergency access. A `signature` holds `Ed25519`, the key id (`{master key id}:audit-v1`) and the signature over the canonical JSON of the document without the signature, encoded as unpadded base64url. The export writes an `audit.exported` entry after the document is built, so it never lists itself.
- `GET /api/tenant/audit-events/signing-keys` (`listAuditSigningKeys`) returns the workspace's public key for every master key in the keyring, so exports made before a rotation still verify.
- All three need `audit-log`, which only admins hold.

Anyone with the export and the public key can check that it was not changed, and recompute each event's hash with `parfocal_api.audit.event_hash` to check it against its previous hash. The chain head lets an inspector compare the export with a later one.

## Consequences

- Someone who controls both the database and the master key can still forge a consistent history. TODO: OPS anchors the chain heads outside the database, for example in a nightly signed record or an object-lock bucket, when cloud access returns.
- The master key now also signs. Rotating it changes the key id of new exports, and the old master key must stay in the keyring for as long as old exports must verify.
- SEC-007 (access and erasure requests) uses the export with `patient_id` for a patient's access request.
- The SEC-024 backlog text names leads and departments. Admins have the whole workspace instead, and project owners have no audit view yet.
