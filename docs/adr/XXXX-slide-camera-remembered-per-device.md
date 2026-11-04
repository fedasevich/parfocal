# XXXX. A slide's camera is remembered on the device across visits

- Date: 2026-11-04
- Status: Accepted
- Deciders: owner
- Backlog: CASE-017 (remember a slide's camera across visits). Supersedes the "while the case is open" part of [ADR 0176](0176-case-view-state-model.md) (case view state model). CASE-003 (per-slide view memory) built that part.

## Context

ADR 0176 keeps each slide's last camera in a module map that lives while the case is open and is cleared on another case, on sign out and on reload. On 2026-11-04 the owner answered decision 36 with b: remember it per device across visits, so a slide opened again later starts where the person left it. Several people may share one workstation in a lab, and the browser storage rules of the [cookie and storage policy](../compliance/cookies-and-storage.md) apply.

## Options considered

1. Keep the memory for the open case only, as built. Rejected by the owner.
2. Store the cameras on the server per user. Follows a person across devices, but adds a table, a write on every camera rest and a migration, for a convenience.
3. Store them in `localStorage` keyed by user and slide. One device only, no server cost, and on a shared workstation each person keeps their own.

## Decision

Option 3.

- The key is `parfocal.slide-cameras`. Its value maps the signed-in user's opaque id and the slide id to the last complete camera `{ x, y, z }` and the time it was written. It holds no name, file name or patient data and is never sent to a server.
- It is written when the camera of a slide rests, as the in-memory map is today, and read when a link to a slide is built and when a slide opens with no camera in its URL and no `object`. The order stays: URL camera, then the frame of `object`, then the remembered camera, then the slide fitted.
- Entries older than 30 days are dropped, and at most 200 slides are kept per user, the oldest going first.
- Sign out keeps the entries, since they are keyed by user. Another person signing in on the same device never reads them. Erasing a user does not reach the device, which is acceptable because the entry holds only opaque ids and numbers.
- Every other rule of ADR 0176 stays: the URL carries the current slide's camera, the memory is keyed by slide across workspaces, and the review position is never stored on its own.

## Consequences

- CASE-017 moves the map in `screens/review/slide-switch.ts` behind a small store that reads and writes `localStorage`, with tests for the expiry, the cap and the user keying.
- The cookie and storage policy gains a row for `parfocal.slide-cameras`, and its line that local entries hold no identifier of the user changes to allow the opaque user id that keeps people apart on a shared device. The entry is a user interface preference the person asked for, so it needs no consent under Article 5(3) of the ePrivacy Directive, as the other local entries do not.
- ADR 0176 keeps its status for the parts this record does not change.
