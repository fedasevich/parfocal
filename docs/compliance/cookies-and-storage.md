# Cookie and consent policy

What Parfocal stores in the browser and why no consent banner is shown, written for SEC-021 (GDPR documentation). The decision is [ADR 0171](../adr/0171-analytics-without-device-storage.md) (analytics without device storage). `apps/web/test/device-storage.test.ts` fails when the code uses a cookie or storage key that this page does not list.

Simulated check, no such person took part. Agents wrote this page where counsel or a privacy professional would write or review it ([agent-stand-in-records.md](../project/agent-stand-in-records.md)).

## Cookies

Both are set by the API, are HttpOnly and Secure, and cannot be read by scripts. Both are strictly necessary for signing in.

| Name | Purpose | Lifetime | Set by |
|---|---|---|---|
| `__Host-parfocal_login` | Binds a sign-in in progress to this browser, SameSite=Lax | 10 minutes | API, [ADR 0025](../adr/0025-zitadel-bff-login.md) |
| `__Host-parfocal_signup` | Binds a sign-up waiting for its email code to this browser, sealed so it cannot be read, SameSite=Strict | 30 minutes | API, [ADR 0294](../adr/0294-native-sign-up-and-sign-in-through-zitadel-session-api.md) |
| `__Host-parfocal_session` | The random session id, stored on the server only as a hash, SameSite=Strict | The session, which ends after 12 hours by default and on sign-out | API, [ADR 0025](../adr/0025-zitadel-bff-login.md) |
| `__Host-parfocal_passkey` | Binds a passkey sign-in or passkey setup in progress to this browser, sealed so it cannot be read, SameSite=Strict | 5 minutes | API, IAM-032 (passkeys on the app's own origin) |

## Local and session storage

All are set by the web app for features the user uses, hold no name or contact detail of the user and are never sent to a server.

| Key | Storage | What it holds | Why it is needed |
|---|---|---|---|
| `parfocal.device-settings` | localStorage | The device layer of the settings, such as the theme (system, light or dark) | Keeps the settings that belong to this device |
| `parfocal-theme` | localStorage | The theme from before the device layer | Read once, moved into `parfocal.device-settings` and removed |
| `parfocal-developer-mode` | localStorage | On or absent | Keeps developer mode on for people who turned it on |
| `parfocal-lab-settings` | localStorage | JSON of the developer drawer controls | Keeps a researcher's renderer, culling, interpolation, prefetch, detail level, nuclei, HUD and pause choices in the developer drawer |
| `parfocal.slide-cameras` | localStorage | The opaque id of the signed-in user, the slide id and the last camera (x, y, zoom) with the time it was written, for 30 days and at most 200 slides per user | Reopens a slide where the person left it, and keeps people on a shared workstation apart. No name, file name or patient data. [ADR 0229](../adr/0229-slide-camera-remembered-per-device.md) |
| `parfocal.event-log` | localStorage | The last 300 ids-only timing events (task, area and cell times, chrome coverage) of people who allow analytics. Never written after an opt-out | Feeds the task timing dashboard on this device. No name, free text or patient data |
| `parfocal.study` | localStorage | The moderator's study rounds, task sets and session timings on the study page. Participant codes only, no names or patient data | Lets a moderated test run and its rounds compare. Written only on the study page, deleted by clearing site data |
| `parfocal.study.guard` | localStorage | The study task in progress: its session and task IDs and the screens it may visit. No names or patient data | Shows a visible message when a participant leaves the task's screens. Written while a study task runs, removed when it ends or by clearing site data |
| `parfocal.study.blocks` | localStorage | A list of the wrong destinations a participant tried during a study task. Screen paths and times only | Lets the moderator see where participants got lost. Written while a study task runs, removed when the moderator clears it or by clearing site data |
| `parfocal.viewer-return` | sessionStorage | The address of the last page a slide was opened from, such as My work, a project or the disagreements queue, without any search text | Lets the viewer's back link return to that page. Cleared when the tab closes |
| `parfocal.pinned-slide-strip` | localStorage | On or off | Keeps the slide strip pinned in the viewer |
| `parfocal.slide-brightness` | localStorage | A number | Keeps the viewer's brightness setting |
| `parfocal.outline-mode` | localStorage | One of fade, mark-unsure or bands | Keeps how the review viewer shows AI confidence on outlines |
| `parfocal.length-units` | localStorage | `auto` or `um` | Keeps whether lengths switch to mm automatically or always show in µm |
| `parfocal.smart-hover-preview` | localStorage | `on` or `off` | Keeps whether smart select previews the outline under the pointer |
| `parfocal.hints-seen` | localStorage | The names of the hints and first-time tips this browser has seen, such as `settings.tools`, `viewer.tool.ruler`, `coach.guided` or `checklist.open-sample`. No names or patient data | Shows each explanation, tool hint, guided review tip and getting started step once. It holds the hints of a guest, and the hints a signed-in person used before the server list loaded, which are then moved into their personal settings and removed here. The old keys `parfocal.tool-hints-seen`, `parfocal.guided-coach` and `parfocal.checklist-tried` are folded into this one the first time the app loads and then deleted. Removed by clearing site data, or by Show all hints again |
| `parfocal.passkey-email` | localStorage | The work email of the last person who signed in with a passkey on this browser | Offers that person's passkey on the sign-in page at once. Removed by clearing site data |
| `parfocal.passkey-offer-declined` | localStorage | The word yes after someone clicks Not now on the offer to save a passkey | Stops the offer from showing again on this browser. Settings, Privacy, Add a passkey still works. Removed by clearing site data |
| `parfocal.inspector-panel` | localStorage | The opaque id of the signed-in user, the side panel width, whether it is hidden and the hide while panning option | Keeps the viewer's side panel as the person left it, and keeps people on a shared workstation apart. No name or patient data |
| `parfocal.pseudo-locale` | localStorage | `1` or absent, set by hand or by a test and read only in development builds | Shows the `en-XA` pseudo locale so untranslated screen text stands out. The app never writes it |
| `parfocal.stale-chunk-reload` | sessionStorage | The time the app last reloaded itself because a code file from an older release was gone | Reloads the page once after a release instead of hanging on Loading Parfocal, and never more than once a minute. Cleared when the tab closes |
| `parfocal.uploads.interrupted` | sessionStorage | Project and case ids, file name, size and modification time of unfinished uploads | Offers to resume an upload after a reload. File names may identify a patient, so this stays in `sessionStorage`, which the browser clears when the tab closes |
| `parfocal.sign-in-redirect-at` | sessionStorage | The time of the last automatic trip to the sign-in page | Sends a signed-out visitor to sign in once, and stops a redirect loop if the session still fails afterwards |
| `parfocal.drafts` | sessionStorage | Unsent comment drafts, keyed by the user id and the thread | Keeps a draft through log out and back in. Comments may describe a patient, so this stays in `sessionStorage`, which the browser clears when the tab closes, and a draft shows only to the user who wrote it |
| `parfocal.prototype.origin` | sessionStorage | Where a prototype flow started, with the ids of its demo project, task and slides | Returns to the flow map in the prototype screens |

## Third parties

No third party sets a cookie or storage entry. Production error reports (Sentry) and, when STACK-033 adds them, product analytics (PostHog) run without device storage and carry only a pseudonymous user id. Users can opt out of analytics through EXP-007 (consent and opt-out).

## Consent

Everything above is strictly necessary for a service the user asked for, so Article 5(3) of the ePrivacy Directive needs no consent and Parfocal shows no consent banner. Product analytics rely on legitimate interest with an opt-out (ADR 0171). The owner accepted on 2026-11-04 that analytics without device storage need no consent, and counsel checks that reading for the first tenants' countries in SEC-030 (legal review before the first real tenant). Adding any other cookie or storage key means updating this page, and anything not strictly necessary needs a new ADR and a consent banner first.
