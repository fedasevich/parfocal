# XXXX. Analytics events are a closed, ids-only list, and PostHog Cloud stays the vendor

- Date: 2026-11-09
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: EXP-000 (experiments research check), STACK-033 (feature flags, experiments and product analytics), EXP-002 (PHI-free event taxonomy), EXP-007 (consent and opt-out), EXP-001 (feature flag service integration)

## Context

STACK-033 left the vendor open among GrowthBook, PostHog, Unleash and Statsig. ADR 0003 (pilot platform architecture) names PostHog Cloud for flags, experiments, analytics and surveys, with autocapture and session replay off. ADR 0005 (only production sends) says other environments read flag defaults from a local file. ADR 0171 (analytics without device storage) says analytics never write to the device, measure only signed-in users by pseudonymous user id, and honour a per user and per workspace opt-out.

The event list was built under EXP-002, EXP-005 (surveys), EXP-006 (task timing) and EXP-011 (analytics policy) and exists only in code. This record writes it down as the contract.

What exists on 2026-11-09:

- `apps/web/src/telemetry/events.ts` holds `eventSchema`, a closed map from event name to typed fields, and `eventSink`. The sink drops an event when the person has opted out or when `eventProblems` finds an unknown event, an unknown field, a missing field or a value of the wrong kind.
- `apps/web/src/clients.ts` wraps the production analytics client in `scrubbedAnalytics` (known sensitive values redacted) and then `consentedAnalytics` (a second opt-out check).
- `apps/web/src/telemetry/app-events.ts` is the single place components reach the sink. Nothing imports a vendor SDK, and no production analytics factory or PostHog package exists yet.
- `apps/web/test/telemetry-events.test.ts` and `telemetry-scrubbing.test.ts` reject free text fields and sensitive values.

## Options considered

1. Keep PostHog Cloud as ADR 0003 says, behind the existing `Analytics` interface, with the closed event list as the contract.
2. Switch to GrowthBook or Unleash self-hosted. These run always-on services, which ADR 0003 and the $30 a month budget rule out.
3. Let PostHog autocapture and capture free form events. Less code, but URLs, element text and form values can carry patient data.

## Decision

Option 1. STACK-033 is confirmed: PostHog Cloud (EU region) for flags, experiments and analytics, with autocapture, session replay and surveys' own capture off. Our in-app surveys (EXP-005) stay ours and send ordinary events.

Naming rule.

- An event name is lower snake case, an area word first and a past participle last, such as `review_decision_recorded` or `task_finished`. Names are never built from data.
- A property name is lower snake case. A duration ends in `_ms`, a ratio in `_permille` or `_tenths`, so every number is an integer.
- A new event is added by editing `eventSchema` and its test in the same change. There is no free form `capture` call in feature code.

Events as built (all in `eventSchema`).

- Navigation: `navigation_area_opened` (area), `navigation_case_opened` and `navigation_slide_opened` (case id, slide id).
- Review: `review_decision_recorded` (case id, slide id, result id, decision of agree, disagree or unsure).
- Tools: `tool_selected` (tool, slide id) and `tool_used` (tool, slide id, count).
- Task boundaries and timing: `task_started`, `task_finished`, `task_abandoned` (task kind, case id, and a duration in milliseconds on the last two), `area_time_recorded`, `cell_review_timed`, `chrome_coverage_measured`, `reading_time_compared`.
- Surveys: `seq_answered`, `sus_answered` (ten item scores and a score in tenths) and `survey_dismissed`.

Allowed property kinds, and only these.

- An opaque id matching `^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$`, for cases, slides and results.
- A choice from a fixed list in the schema (area, decision, tool, survey, task kind).
- A non-negative safe integer count, duration or score.

Forbidden.

- Free text of any kind, including notes, comments, survey comments, search queries, file names, slide labels and error messages.
- Patient, case or accession numbers, names, dates of birth and any value from the clinical record. Case and slide ids are internal opaque ids, never external identifiers.
- Identifiers or query strings in URLs. Route paths are never sent as properties.
- Email, IP address, device or browser fingerprints, user agent strings and screen contents.
- Autocapture, session replay, heatmaps and PostHog persistence on the device, per ADR 0171.
- Any send outside production, per ADR 0005, and any send after opt-out.

Identity and flags.

- The person is identified only by the pseudonymous user id from the session, attached by the production client, never as an event property. The workspace id is attached the same way as a PostHog group, not as a property.
- Flag evaluation uses the same id. An experiment records one exposure event when the arm is first shown, with the flag key and arm as choices. Because PostHog's own `$feature_flag_called` event would bypass the schema, EXP-001 either turns it off or lists the exposure in `eventSchema`.

## Consequences

- EXP-001 builds the production factory, the local flag file and the exposure event against this list. It confirms PostHog's in-memory persistence, as ADR 0171 already requires, and otherwise sends from the API.
- The production client must attach the user id and workspace group itself. The current sink passes only name and properties, so the identity hook is new work in EXP-001.
- `eventSink` drops invalid events silently. A test per new event keeps drift visible, and a counter of dropped events is a possible later addition.
- The event log kept for the person on their own device (`parfocal.event-log` in `localStorage`) is a local transparency feature, not analytics, and stays listed in cookies-and-storage.md.
- TODO: a real product choice for the owner. Recommended: keep workspace id as a PostHog group so experiments can be read per lab, rather than dropping it for stricter pseudonymity. Alternative: user id only.
