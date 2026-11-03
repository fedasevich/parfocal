# Cookie and consent policy

What Parfocal stores in the browser and why no consent banner is shown, written for SEC-021 (GDPR documentation). The decision is [ADR 0171](../adr/0171-analytics-without-device-storage.md) (analytics without device storage). `apps/web/test/device-storage.test.ts` fails when the code uses a cookie or storage key that this page does not list.

## Cookies

Both are set by the API, are HttpOnly and Secure, and cannot be read by scripts. Both are strictly necessary for signing in.

| Name | Purpose | Lifetime | Set by |
|---|---|---|---|
| `__Host-parfocal_login` | Binds a sign-in in progress to this browser, SameSite=Lax | 10 minutes | API, [ADR 0025](../adr/0025-zitadel-bff-login.md) |
| `__Host-parfocal_session` | The random session id, stored on the server only as a hash, SameSite=Strict | The session, which ends after 12 hours by default and on sign-out | API, [ADR 0025](../adr/0025-zitadel-bff-login.md) |

## Local and session storage

All are set by the web app for features the user uses, hold no identifier of the user and are never sent to a server.

| Key | Storage | What it holds | Why it is needed |
|---|---|---|---|
| `parfocal-theme` | localStorage | Light, dark or system | Keeps the chosen theme |
| `parfocal-developer-mode` | localStorage | On or absent | Keeps developer mode on for people who turned it on |
| `parfocal.pinned-slide-strip` | localStorage | On or off | Keeps the slide strip pinned in the viewer |
| `parfocal.slide-brightness` | localStorage | A number | Keeps the viewer's brightness setting |
| `parfocal.uploads.interrupted` | sessionStorage | Project and case ids, file name, size and modification time of unfinished uploads | Offers to resume an upload after a reload. File names may identify a patient, so this stays in `sessionStorage`, which the browser clears when the tab closes |
| `parfocal.prototype.origin` | sessionStorage | Where a prototype flow started, with the ids of its demo project, task and slides | Returns to the flow map in the prototype screens |

## Third parties

No third party sets a cookie or storage entry. Production error reports (Sentry) and, when STACK-033 adds them, product analytics (PostHog) run without device storage and carry only a pseudonymous user id. Users can opt out of analytics through EXP-007 (consent and opt-out).

## Consent

Everything above is strictly necessary for a service the user asked for, so Article 5(3) of the ePrivacy Directive needs no consent and Parfocal shows no consent banner. Product analytics rely on legitimate interest with an opt-out (ADR 0171). Adding any other cookie or storage key means updating this page, and anything not strictly necessary needs a new ADR and a consent banner first.
