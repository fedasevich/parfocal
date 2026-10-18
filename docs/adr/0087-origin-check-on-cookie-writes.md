# 0087. Cookie-authenticated writes must come from the app origin, checked by `Origin` or `Sec-Fetch-Site`

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: SEC-025, SEC-016, SEC-011

## Context

The session is a `__Host-` cookie with SameSite=Strict ([ADR 0025](0025-zitadel-bff-login.md)). That stops cross-site requests, but "site" is the registrable domain, so a page on any other subdomain of the app's domain is same-site and its requests carry the cookie. The [threat model](../security/threat-model.md) rates this High (X1), because a single compromised or user-content subdomain would be enough. Service accounts call the API with bearer tokens and no cookie ([ADR 0029](0029-service-accounts-with-own-api-tokens.md)).

## Options considered

1. A synchronizer or double-submit CSRF token. Works in every browser, but the SPA must fetch and send it on every write, the generated client needs a hook, and a token in a readable cookie is itself exposed to a same-site page.
2. Check `Origin` on unsafe methods, falling back to `Sec-Fetch-Site: same-origin` when `Origin` is missing. Browsers send `Origin` on every non-GET request, and `Sec-Fetch-Site` in every supported browser. No client change and nothing to store.
3. Rely on SameSite=Strict only. No work, and the gap above stays.

## Decision

Option 2, as an ASGI middleware in front of every route (`parfocal_api.origin_check`). A POST, PUT, PATCH or DELETE that carries the session cookie and no `Authorization` header is refused with 403 `cross-origin-write` unless its `Origin` equals the public origin, ignoring case, or, with no `Origin`, its `Sec-Fetch-Site` is `same-origin`. `Origin: null` is refused. Requests without the session cookie, bearer token calls and safe methods pass untouched, so service accounts and the login callback (a GET) keep working.

## Consequences

- SEC-025 ships the middleware with unit tests of the rule and an API test with a signed-in browser.
- Test clients that sign in as a browser send the app origin, as a real browser does.
- Safe methods must stay free of side effects, because they are not checked. The routes already follow this, and logout is the one GET that changes state, which a same-site page can only use to sign someone out.
