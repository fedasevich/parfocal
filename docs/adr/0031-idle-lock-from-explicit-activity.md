# 0031. Idle lock driven by explicit activity, unlocked by signing in again, with limits set per workspace

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-009, IAM-021, SET-001

## Context

IAM-009 asks for an idle lock after a lab-set time (default 15 minutes), a list of concurrent sessions, signing out other devices, and a configurable session lifetime instead of IAM-002's fixed 12 hours ([ADR 0025](0025-zitadel-bff-login.md)). Sessions already record `last_seen_at`, updated at most once a minute by any authenticated request. The lock screen that returns to the same view is UI, and the UI is not final.

## Options considered

1. What counts as activity. Any authenticated request is free to track, but background calls such as polling, prefetching or a status board left on a wall screen would keep a session open forever. An explicit `POST /api/auth/activity`, sent by the web app on keyboard, pointer and viewer input at most once a minute, measures the person rather than the page.
2. How to unlock. A local PIN needs its own secret, reset flow and brute-force rules. Signing in again through Zitadel with `prompt=login` reuses the IdP's password, MFA and lockout rules. The web app keeps the view in memory and the login's `return_to` carries the deep link, so the person comes back to the same place.
3. Where the limits live. Columns on `tenants` would need members to write that table, which only the platform scope may do. A tenant-owned `session_policies` row keeps row-level security as it is.

## Decision

- `sessions` gains a public `id`, `active_at` (set at login and by `recordActivity` only) and the browser's user agent. A session whose `active_at` is older than the workspace's idle time answers 401 `session-locked` and stays locked. A session older than the workspace's session hours is deleted.
- `/api/auth/login?reauth=true` adds `prompt=login`, so Zitadel asks for the password even with a live IdP session. A completed login deletes the session whose cookie it replaces.
- `session_policies` holds `idle_lock_minutes` (1 to 240, default 15) and `session_hours` (1 to 24, default 12) per workspace. `getSessionPolicy` is open to members, and `updateSessionPolicy` needs `lab-setup`, which leads hold and administrators may only view. Changes are audited.
- `listSessions`, `endSession` and `endOtherSessions` let a person see and end their own sessions. Ended sessions have their refresh tokens revoked at Zitadel, and the ending is audited.
- The lock screen and the return to the same camera position move to a new task, IAM-021, because they need the final UI.

## Consequences

- Until IAM-021 the web app sends no activity, so a session locks 15 minutes after login or the last unlock. No screen uses the API yet, so this has no effect today.
- The limits that apply are the active workspace's. Switching to a workspace with a shorter idle time can lock a session at once, which is the safer reading.
- TODO: SET-001's lab setup screens show and change the policy.
