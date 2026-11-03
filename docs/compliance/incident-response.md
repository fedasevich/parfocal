# Incident response and breach notification runbook

This runbook says what to do when something goes wrong with security or with personal data at Parfocal. It is the output of SEC-018 (incident response and breach notification runbook) and the choices behind it are in [ADR 0186](../adr/0186-incident-response-and-breach-notification.md). It was written on 2026-11-03 against the services in [subprocessors.md](subprocessors.md) and [knowledge/platform.md](../knowledge/platform.md).

The pilot holds only public slide datasets with seeded fake patients ([ADR 0003](../adr/0003-pilot-platform-architecture.md), pilot platform architecture). The runbook still applies in full, because accounts, emails and sign-in events of real users are personal data today. This is a draft until counsel reads it. TODO: counsel review before the first tenant with real patient data.

## Who is who in an incident

Parfocal has two roles under GDPR, as [records-of-processing.md](records-of-processing.md) says. That decides who notifies whom.

| Data affected | Parfocal's role | Who tells the supervisory authority and the people affected | Parfocal's duty |
|---|---|---|---|
| Anything a workspace stores: slides, results, review work, patients, cases, the workspace's audit log | Processor | The workspace, which is the controller | Tell every affected workspace without undue delay and within the hours the [DPA](dpa-template.md) sets (clause 4.6, 24 hours in the draft), then help it (Art. 33(2)) |
| Parfocal's own processing: sign-in and sessions, platform operators, rate limit counters, telemetry, analytics, email delivery | Controller | Parfocal | Tell the supervisory authority within 72 hours (Art. 33) and the people affected when the risk is high (Art. 34) |

One incident can hit both, for example a stolen database copy that holds `users` and `patients`. Then both columns apply.

## Roles

There is one person behind Parfocal today, so most roles fall on the owner. The roles still have names so the runbook works when more people join.

| Role | Does what | Who |
|---|---|---|
| Incident lead | Runs the incident, decides severity, keeps the timeline, decides whether to notify | TODO: the owner names the lead and a deputy |
| Technical responder | Contains and fixes. An agent may help with reads and with additive fixes. Every delete, rotation, purge or reset still needs the owner's yes in chat, one action at a time ([ADR 0115](../adr/0115-production-access-and-spend-caps.md), [ADR 0151](../adr/0151-standing-approval-for-production-within-30-dollars.md)) | The owner, with agents |
| Privacy contact | Judges the risk to people, writes the notices, talks to the authority | TODO: the owner, or the data protection officer once one is named ([records-of-processing.md](records-of-processing.md)) |
| Counsel | Checks the notices and the decision not to notify | TODO: name and contact |

## Severity

| Level | Meaning | Examples | First response |
|---|---|---|---|
| SEV1 | Personal data of another tenant or patient data is exposed or lost, or an attacker holds production access | A request returns another workspace's rows, a production secret is public, the master key leaks, an R2 object of `parfocal-prod` is public | Start the clock now. Contain within the hour. Assume notification is needed until the assessment says otherwise |
| SEV2 | Personal data of Parfocal's own users is exposed, or a control failed with no proof of access | A user's email shows in a Sentry event, a bug skipped row level security on one route that nobody called, a staff account was phished but MFA held | Contain the same day. Run the breach assessment |
| SEV3 | A security event with no personal data reached | A blocked attack, a leaked token for `parfocal-dev` only, an unexpected charge, a resource nobody created | Log it in the register and fix it in a backlog task |

Raise the level when in doubt. A level can drop later, and the register keeps both.

## The clock

The 72 hours of Art. 33 run from the moment Parfocal becomes aware of a breach, which means a reasonable degree of certainty that personal data was hit. A short investigation to reach that certainty is allowed, but it must start at once. Write the time of first notice and the time of awareness in the register, both in UTC.

| From awareness | As controller | As processor |
|---|---|---|
| Hour 0 | Open a register entry. Preserve evidence | Same |
| Within 24 hours (TODO: the hours counsel sets in DPA clause 4.6) | | Tell every affected workspace with what is known, even if incomplete |
| Within 72 hours | Notify the supervisory authority unless the breach is unlikely to result in a risk to people. If facts are missing, notify anyway and send the rest in phases (Art. 33(4)). If late, give the reasons for the delay | Answer the workspace's questions so it can meet its own 72 hours |
| Without undue delay | Tell the people affected when the risk to them is high (Art. 34), unless Art. 34(3) applies | Help the workspace tell its patients if it asks |
| Always | Record the breach, its effects and the action taken, even when nobody is notified (Art. 33(5)) | Record it the same way |

## Steps

### 1. Detect and report

Anyone who notices something wrong reports it at once, even if unsure. Sources today are listed under [alert channels](#alert-channels-and-contacts). A report gets a register entry with a new ID such as `INC-2026-001` in [incident-register.md](incident-register.md). Never write PHI, patient names, file names that may name a patient, or secrets into the register, a ticket, a chat or a commit. Describe them by kind and count.

### 2. Triage

1. Name the incident lead.
2. Answer five questions in the register: what happened, since when, which environment, which tenants, which data classes ([data map](../reference/data-map.md)).
3. Set the severity.
4. Decide whether it touches personal data. If yes, start the breach assessment in step 5 in parallel with containment.

### 3. Contain

Stop the damage first, keep evidence second, fix third. Each action below is a production write. Additive ones need no question under ADR 0151. The ones marked "ask" need the owner's yes for that one action.

| Situation | Containment |
|---|---|
| Leaked secret or token | Revoke and rotate it at the provider (ask). Check its use in the provider's logs. Remove it from history only if the owner agrees, never by force-push without that yes |
| Leaked or suspected master key | Add a new key, rewrap every tenant's data keys, remove the old key ([ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md)) (ask) |
| Cross-tenant read or write | Turn the route off or deploy a fix that refuses the request. Keep the logs |
| Public or misconfigured R2 object | Turn public access off on the bucket (ask if it changes an existing setting) |
| Compromised user or staff account | End the account's sessions, deactivate it in Zitadel (ask), check its audit trail and any emergency access it opened ([ADR 0066](../adr/0066-emergency-access-per-clinical-project.md)) |
| PHI found in logs or telemetry | Stop the sender, delete the events at Sentry or Grafana (ask), fix the scrubber allow-list ([ADR 0040](../adr/0040-observability-and-phi-scrubbing.md)) |
| Abuse or denial of service | Tighten the edge rate limits ([ADR 0088](../adr/0088-rate-limits-in-postgres-and-at-the-edge.md)) |
| Unexpected charge or resource nobody created | Stop and tell the owner, as AGENTS.md says. Do not delete it before the owner looks |
| Request from a foreign authority for data (Art. 48) | Do not answer or hand anything over. Pass it to the incident lead and counsel. Tell the affected workspace unless the law forbids it |

### 4. Preserve evidence

- Place a legal hold on the affected workspace or project so the retention job purges nothing ([ADR 0089](../adr/0089-retention-purge-and-audit-re-anchor.md)).
- Take a signed audit export for the affected workspaces and period ([ADR 0073](../adr/0073-audit-queries-and-signed-export.md)).
- Save provider logs that expire soon: Cloudflare Worker logs, Modal app logs, Neon branch state, Zitadel events. A Neon branch from the current state keeps the database as it was.
- Write every action into the register timeline with the UTC time and who did it.

### 5. Assess the breach

A personal data breach is a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data (Art. 4(12)). It covers loss of availability too, such as a lost backup with no copy.

Judge the risk to people, not to Parfocal. Write the answer and the reasons in the register.

| Factor | Lowers the risk | Raises the risk |
|---|---|---|
| Data class | Operational data, pseudonymous ids | Health data, patient identifiers, free text notes, credentials |
| Protection | Sealed by tenant keys that were not exposed ([ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md)) | Clear text, or the keys went with the data |
| Who got it | A trusted recipient who confirms deletion | Unknown party, public internet |
| Scale | One record, one person | Many people, many workspaces |
| People | Staff with a work account | Patients, which is special category data under Art. 9 |

Outcomes:

- No risk likely: record only (Art. 33(5)).
- Risk: notify the authority within 72 hours.
- High risk: notify the authority and the people affected. Art. 34(3) lets Parfocal skip telling people when the data was unintelligible to the recipient, when later measures removed the high risk, or when telling each person is disproportionate and a public notice is used instead.

### 6. Notify

Write each notice from the register. Keep PHI out of every notice.

The notice to the supervisory authority holds what Art. 33(3) lists:

1. The nature of the breach, with the categories and approximate number of people and records.
2. The name and contact of the privacy contact.
3. The likely consequences.
4. The measures taken or proposed, including those to reduce harm.

The notice to a workspace (processor duty) holds the same four items as far as they are known, the incident ID, and what the workspace must decide. Send it to the workspace's registered security contact. TODO: the workspace settings have no security contact field yet, so this needs a backlog task before the first tenant.

The notice to people (Art. 34(2)) uses clear plain language and holds items 2 to 4 above, with what the person can do to protect themselves.

Email to users goes through Resend in production ([ADR 0039](../adr/0039-email-through-resend-with-phi-rules.md)). Resend's free plan pauses at 100 emails a day ([platform.md](../knowledge/platform.md)), so a notice to many people needs a plan for that cap. TODO: decide it when the Resend account is created.

| Notify | Where | Who |
|---|---|---|
| Supervisory authority | TODO: the authority of the member state of Parfocal's main establishment, its breach form or address, once the owner names the legal entity | Privacy contact |
| Affected workspaces | The workspace security contact (TODO above) | Incident lead |
| People affected | Email through Resend, or a public notice under Art. 34(3)(c) | Privacy contact, after counsel |
| Subprocessor whose service failed | Its security contact, see the contact table | Incident lead |
| Police or CSIRT | TODO: whether to report, and to which national CSIRT | Incident lead |

### 7. Recover

Deploy the fix through the normal pipeline with a test that fails before it. Restore from backup only by the restore steps of SEC-014 (backups and restore testing), which are not written yet. Lift the legal hold only after the incident is closed and counsel agrees.

### 8. Learn

Within two weeks of closing, write a short review into the register entry: timeline, cause, what worked, what did not, and the backlog tasks it created. Every High finding becomes a backlog task with an owner. Update this runbook and the [threat model](../security/threat-model.md) if they were wrong.

## Alert channels and contacts

SEC-018 asks that contacts be configured for alerting. That needs the owner's accounts, so it cannot be done from the repository. This section lists what exists on 2026-11-03, from [platform.md](../knowledge/platform.md) and [agent-tooling.md](../knowledge/agent-tooling.md), and what the owner must set.

### What alerts exist today

| Source | What it tells | Where it goes | Gap |
|---|---|---|---|
| Cloudflare account budget alert "Default budget alert (auto-created)" | Spend passes $1 | Email to the Cloudflare account address | Cost only, no security signal |
| Modal usage limit $30 and spend limit $0 | Stops workloads when credits run out | Shown in Modal. Whether Modal emails is not recorded | Cost only |
| Neon and Workers free plans | Stop work at the plan limit | Not recorded | Cost only |
| GitHub budgets and included usage alerts | Usage of Actions, Packages, Codespaces, LFS and AI credits | Email to the GitHub account | Cost only |
| CI secret scan with betterleaks in `.github/workflows/ci.yml` | A secret in a pull request | The failing CI check | Only on code that goes through CI |
| Sentry, Grafana Cloud, PostHog, Resend | Nothing yet | No accounts exist | Errors, traces, latency and email bounces are not watched. OPS-006 (observability stack) and OPS-007 (alerting and on-call) build them |

No channel today alerts on a security event in production, such as a burst of failed sign-ins, an emergency access grant or an audit chain break.

### Owner checklist

Tick each item in the owner's own record, with the date. None of these can be done from a cloud session.

- [ ] Name the incident lead, a deputy, the privacy contact and counsel in the roles table above.
- [ ] Choose one security contact address, for example a mailbox at `parfocal.eu`, and write it here. TODO: the address.
- [ ] Check that the Cloudflare, Modal, Neon (through Vercel), Zitadel, GitHub and Endora account emails reach a mailbox the incident lead reads, and write which address each uses.
- [ ] Turn on account security notifications in each: new sign-in, API token created, member added. Write which ones each provider offers.
- [ ] In Zitadel, decide whether failed sign-in and lockout events should notify the security contact, and set it if so.
- [ ] In GitHub, turn on private vulnerability reporting and Dependabot alerts for `fedasevich/parfocal`, and set where alerts go.
- [ ] Add a `SECURITY.md` to the repository with the security contact, once the address exists.
- [ ] When Sentry, Grafana Cloud and Resend accounts are created, route their alerts to the security contact on day one, as platform.md already asks for spend.
- [ ] Find the breach notification form of the supervisory authority and write its link in the contact table.
- [ ] Record each subprocessor's security contact from its DPA in the contact table.
- [ ] Run the [tabletop exercise](tabletop-exercise.md) and record it.

### Contact table

Every entry is a TODO. Do not fill it from memory or the web without checking the source on the day.

| Who | Contact | Source and date checked |
|---|---|---|
| Incident lead | TODO | |
| Deputy | TODO | |
| Privacy contact | TODO | |
| Counsel | TODO | |
| Supervisory authority | TODO | |
| National CSIRT | TODO | |
| Cloudflare security | TODO | Cloudflare DPA |
| Modal security | TODO | Modal DPA |
| Neon security | TODO | Neon DPA |
| Zitadel security | TODO | Zitadel DPA |
| Resend, Sentry, Grafana, PostHog | TODO when each account exists | Their DPAs |

## Later readiness: HIPAA

Parfocal does not serve covered entities in the United States today, so HIPAA does not apply. SEC-020 (HIPAA readiness pack) will add what it needs: the Breach Notification Rule (45 CFR 164.400 to 414), its separate deadlines and the duty of a business associate to tell the covered entity, and BAAs with the subprocessors. Until then this runbook follows GDPR only.

## Keeping this runbook current

Read it again after every SEV1 or SEV2, after each tabletop exercise, when a subprocessor is added and on the day the first tenant with real patient data arrives.
