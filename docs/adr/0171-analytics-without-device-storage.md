# 0171. Product analytics store nothing on the device, so Parfocal shows no consent banner

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: SEC-021 (GDPR documentation), STACK-033 (feature flags, experiments and product analytics), EXP-007 (consent and opt-out)

## Context

SEC-021 asks for a consent banner if any analytics need consent. Article 5(3) of the ePrivacy Directive needs consent before storing or reading anything on a user's device unless it is strictly necessary for a service the user asked for. GDPR then needs a legal basis for the personal data itself.

What exists on 2026-11-03:

- The web app sets no cookie. The API sets `__Host-parfocal_login` and `__Host-parfocal_session` for sign-in ([ADR 0025](0025-zitadel-bff-login.md)), which are strictly necessary.
- The web app keeps a few preferences and resume hints in `localStorage` and `sessionStorage`, all for features the user uses ([cookies-and-storage.md](../compliance/cookies-and-storage.md)).
- No analytics run. `selectWebClients` gives a no-op analytics client outside production, and production has no analytics factory yet ([ADR 0005](0005-external-sends-only-in-production.md)). STACK-033 will add PostHog Cloud with autocapture and session replay off ([ADR 0003](0003-pilot-platform-architecture.md)).
- Errors go to Sentry in production with session replay off and only a pseudonymous user id ([ADR 0040](0040-observability-and-phi-scrubbing.md)).

## Options considered

1. PostHog's browser SDK with its default persistence, which keeps an anonymous id and properties in a cookie or `localStorage`, plus a consent banner. Analytics would stop for everyone who declines, a banner adds a screen to a clinical tool used all day, and the consent must be recorded and renewable.
2. Analytics with no device storage. Events carry the signed-in user's pseudonymous id, which the app already knows from the session, so nothing needs to be kept on the device. The browser SDK runs with in-memory persistence, or events are sent from the API. Legal basis is legitimate interest under Article 6(1)(f), with a per user and per workspace opt-out from EXP-007. No banner.
3. No product analytics at all. Simplest, but experiments such as the lab leads' default home in STACK-033 could not be measured.

## Decision

Option 2.

- Analytics and error reporting never write a cookie, `localStorage`, `sessionStorage` or IndexedDB entry and never read device identifiers or fingerprints. Only signed-in users are measured, by their pseudonymous user id.
- STACK-033 configures PostHog without device storage. The vendor's in-memory persistence option is from its docs and is unverified here: STACK-033 confirms it, or sends events from the API instead.
- EXP-007 adds the opt-out per user and per workspace policy, and its tests confirm no event is sent after opting out.
- Every device storage key and cookie is listed in [cookies-and-storage.md](../compliance/cookies-and-storage.md). `apps/web/test/device-storage.test.ts` fails when the web app uses a storage key or the API sets a cookie that the page does not list, and when the web app writes `document.cookie`.
- No consent banner is built.

## Consequences

- If a later change needs device storage for analytics, marketing or anything not strictly necessary, this record is replaced and a consent banner with tests is built before that change ships.
- Some supervisory authorities read Article 5(3) to cover any tracking technique, not only cookies. TODO: counsel confirms that option 2 needs no consent in the countries of the first tenants.
- A public marketing site, if one is ever built, needs its own assessment.
