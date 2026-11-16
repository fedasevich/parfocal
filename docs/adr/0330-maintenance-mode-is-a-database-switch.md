# 0330. Maintenance mode is a database switch that pauses API writes

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-011 (status page and maintenance mode). Partly covers 164.308(a)(7)(ii)(C) in [compliance/controls.md](../compliance/controls.md).

## Context

During a risky migration, a restore or an incident the platform must stop taking changes while people can still read slides and results, and everyone must see why. The API runs on Modal and scales to zero, so a switch has to reach every container that starts while it is on.

## Options

1. An environment setting such as `PARFOCAL_MAINTENANCE`. Turning it on or off means a redeploy, which takes minutes and is itself a risky step during an incident.
2. A single row table `maintenance` that a platform operator switches with `PUT` and `DELETE /api/platform/maintenance`. Each API process reads it at most every 5 seconds before a write.
3. A flag at the Cloudflare edge. It would block writes before they reach Modal but splits the state across two systems and needs an edge deploy to change.

## Decision

Option 2. The `maintenance` table holds exactly one row, with row security that lets anyone read and only operators write, like `registered_models`. A middleware refuses `POST`, `PUT`, `PATCH` and `DELETE` with a `503` `maintenance` problem and `Retry-After: 60` while the row has a start. Signing in, recording activity, ending sessions and the switch itself stay open, so an operator can always sign in and end maintenance. Reads are never blocked. `GET /api/status` is public and returns `ok` or `maintenance` with the message and expected end. It is the status endpoint for an uptime monitor, and the web shell polls it every 30 seconds and shows a banner. Starting and ending are audited as `maintenance.started` and `maintenance.ended`.

## Consequences

- A switch reaches every running container within 5 seconds and every new container at once.
- If the database cannot be read, the gate lets writes through and they fail on their own, so a database outage does not look like maintenance.
- Workers write to the database directly and are not paused. Stopping them stays a deploy step.
- A public status page in the web app (`/status`, outside the shell) is not built yet. Today the status lives at `GET /api/status` and in the banner.
