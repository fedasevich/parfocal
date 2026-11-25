# 0442. A one-use link signs a remote study participant into a seat of their own, with no identity provider account

- Date: 2026-11-25
- Status: Accepted
- Deciders: Claude
- Backlog: EXP-020 (a prepared participant joins a remote moderated session by one link). Builds on [ADR 0435](0435-per-participant-study-projects.md) (a project per study participant) and [ADR 0439](0439-the-console-prepares-a-participant-through-the-seed-function.md) (the console prepares a participant through the seed function).

## Context

Decision 176 (whether the next usability round is moderated or remote) chose a remote round that the moderator still watches over a video call. The participant opens the app in their own browser, so they cannot use the moderator's study seat, and asking a stranger to make a Zitadel account and a password for one hour of testing would lose most of them before task 1. Every other session in the app is opened by the identity provider and carries its tokens.

## Options considered

- Make a Zitadel user per participant with a generated password the moderator reads out. It needs a write to the production identity instance per participant and leaves accounts behind.
- A magic link through Zitadel's passwordless flows. It still makes an identity provider user and an email address, and the participant has neither.
- A one-use link that the API redeems itself into a normal session row for a seeded seat that exists only in the study workspace. Nothing outside the app changes, and the seat already exists in the seed as the placeholder participant of ADR 0435.

## Decision

- `POST /api/tenant/study-participants/{code}/link` needs admin rights, as preparing does. It seeds the participant's project with the placeholder seat `seeded:study-<code>@showcase.invalid`, which is a researcher without admin rights and a project owner only on that one project. The moderator joins the study workspace as an admin through the same seed, so the console can follow the participant.
- The link is `/study/join#<token>`, 32 random bytes. The token is in the fragment, so it never reaches a server log, a proxy or a `Referer`. The page sends it in a `POST /api/study-links/redeem`, so a chat preview that fetches the page cannot spend it.
- Only the SHA-256 of the token is stored, in `study_links` (migration 0161, additive). A link expires one day after it is made, and redeeming is one conditional `UPDATE` that sets `redeemed_at` only while it is unset and the link is unexpired, so a second redeem, an expired link and an unknown token all get the same `410 study-link-gone`.
- Making a new link for a code, or removing the code, expires its unused links and ends every session of that seat.
- The redeemed session is a normal session row with sealed tokens that hold no identity provider tokens. Its access expiry equals its end, so it is never refreshed, and sign-out skips the identity provider for it. It ends with the workspace's session hours like any other.
- A study seat is refused the study results (`listStudySessions`, `getStudyTrace`, `markStudyDryRun`) with `study-seat-refused`, because its researcher role would otherwise read every participant's answers. The admin routes refuse it already.
- The console shows each link's participant as waiting, joined, working with tasks done, or finished, polling the links and the uploaded sessions every 5 seconds.

## Consequences

- A participant needs only the link and a browser. The consent screen still opens first, then task 1.
- Anyone holding an unspent link inside its day can open that one study seat. The seat can reach only its own project and its own uploads, inside the study workspace.
- A participant seat is still a researcher in the study workspace, so it could create a project there. That fits the development app (ADR 0390, the deployed app is dev). A narrower study role is TODO before real data.
- Sessions that hold no identity provider tokens are now possible. Code that reads `refresh_token` or `id_token` from a session must tolerate their absence.
