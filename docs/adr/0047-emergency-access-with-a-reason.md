# 0047. Emergency access: a written reason opens one case for a lab-set time, administrators included

- Date: 2026-10-14
- Status: Superseded by 0066
- Deciders: Yurii Fedas
- Backlog: IAM-017, IAM-016, SEC-003, SEC-024, NOTIF-001

## Context

IAM-017 (emergency access with a reason) lets a person open a case outside their folders after giving a reason, for a lab-set time (default 4 hours), for that case only, marked in the audit log, with the folder's lead notified. Administrators have no patient data permissions and use the same path. The matrix of [ADR 0026](0026-roles-and-permission-matrix.md) grades "open a case outside their folders" as "with a reason" for consultants, residents and administrators, "yes" for leads and "no" for lab staff and outside consultants. [ADR 0046](0046-roles-narrowed-by-folders.md) refuses cases outside the folders with `outside-folders`.

## Options considered

1. A flag that lifts the folder limit for a while. Simple, but it opens every case at once, which the kit rules out.
2. A grant row per person and case with an expiry, checked when the case is read. Narrow, auditable and easy to expire.
3. Where the reason lives. Keeping it only in the grant table loses it when grants are cleaned up. Writing it into the audit entry keeps it with the hash chain, which SEC-024 (audit queries and signed export) marks for inspections.

## Decision

Option 2, with the reason in both places.

- `POST /api/cases/{id}/emergency-access` takes a reason of 10 to 500 characters and needs "open a case outside their folders". It creates a grant for that person and case that expires after the workspace's `emergency_hours` (1 to 24, default 4, set with the session policy).
- Reading a case passes when the person has the permission inside their folders, when their "outside folders" grade is "yes" (leads), or when they hold an unexpired grant for that case. Otherwise it answers `outside-folders`, or `emergency-access-needed` for roles with no case permission at all, such as administrators.
- `getCase` is declared with `require(..., emergency=True)`, which lets a role graded "with a reason" reach the route so the grant can be checked, and records `x-permission-emergency` in the schema. Lists stay closed to administrators.
- The audit entry `case.emergency-access` holds the reason, the hours and the role.

## Consequences

- Reasons are free text stored in the audit log. They should say why, not who. TODO: the screen for IAM-017 asks people not to type patient identifiers, and SEC-001's data map classes the reason as PHI.
- The folder's lead is not notified yet, because notifications do not exist. TODO: NOTIF-001 sends the notice from the audit entry.
- Emergency grants open reading only. Calls, reports and sign-out stay with the people whose folders hold the case.
