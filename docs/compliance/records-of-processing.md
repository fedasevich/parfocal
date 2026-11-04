# Records of processing activities

This is the record that GDPR Article 30 asks for, written for SEC-021 (GDPR documentation). It describes what the code and the ADRs do on 2026-11-03. The column level detail is the generated [data map](../reference/data-map.md) of [ADR 0028](../adr/0028-data-classes-on-columns.md) (five data classes on every column). Services are in [subprocessors.md](subprocessors.md) and security measures in [controls.md](controls.md).

## Who is who

| Role | Who | Note |
|---|---|---|
| Parfocal as controller | Yurii Fedas, who runs Parfocal as a natural person until a company is registered. Contact `support@parfocal.eu` for data protection requests and `security@parfocal.eu` for incidents. TODO: the postal address and any registration number, and the company once it exists (SEC-030) | For the platform's own processing: sign-in security, platform operators, rate limits, product analytics and email delivery |
| Parfocal as processor | The same entity | For everything a workspace stores: slides, results, review work, patients and cases. The workspace is the controller, under the [DPA template](dpa-template.md) |
| Data protection officer | None named. The pilot holds no real patient data, so Article 37(1)(c) does not apply yet. TODO: decide again before the first tenant that processes health data at scale (SEC-030) | Large scale health data processing would make a DPO mandatory, the pilot holds no real patient data |
| EU representative | Not needed while the entity is in the EU | TODO: confirm with the entity's details |

## Activities as processor (Article 30(2))

Each workspace (tenant, [ADR 0024](../adr/0024-workspaces-are-tenants.md)) is a controller. The categories below apply to every workspace.

| Activity | Purpose | Data subjects | Personal data | Special category | Stored in | Retention |
|---|---|---|---|---|---|---|
| Workspace membership | Let people work in a workspace with a role | Workspace members, invited people | Email, display name, initials, title, role, availability note, invitations | No | Neon: `users`, `memberships`, `project_members`, `invitations` | Until the member is erased (`POST /api/platform/users/{user}/erase`, [ADR 0090](../adr/0090-access-export-and-erasure.md)). An invitation nobody accepted is deleted 30 days after it expires. SEC-006 (retention policies) builds the purge |
| Slides and uploads | Store and show whole slide images | Patients in clinical projects | Slide labels, barcodes and file names, which may identify a patient. De-identified projects strip names on upload ([ADR 0053](../adr/0053-ai-results-review-direction.md)) | Health data in clinical projects | R2 and Neon: `slides`, `uploads`, `specimens` | Per workspace `deleted_after_days` after a soft delete, empty by default which keeps everything ([ADR 0089](../adr/0089-retention-purge-and-audit-re-anchor.md)). TODO: stored files are not purged yet |
| Patients and cases | Group slides by patient in clinical projects | Patients | Name, MRN and birth date sealed per tenant with blind indexes, sex, age, case labels | Health data | Neon: `patients`, `cases` | Until the project owner erases the patient (`DELETE /api/projects/{project}/patients/{patient}`, ADR 0090). TODO: no purge by period yet |
| AI results and review | Import or run AI results and let reviewers agree, disagree or answer unsure | Reviewers, researchers, and patients through the slides | Result sets with their source file name, decisions with notes, opinions, edits, threads and messages, all tied to a user id | Health data where notes or messages describe a patient | Neon: `result_sets`, `review_*`, `opinions`, `threads`, `thread_messages`, `annotations` | Per workspace retention as above. Signed off work keeps its author ids after erasure, the names become "Former member" |
| Audit log | Prove who did what, for security and accountability | Members, operators, patients as targets | Pseudonymous actor and target ids, event names, no identifiers in clear | No | Neon: `audit_events`, `audit_people` | Per workspace `audit_after_days`, at least 365, empty by default which keeps everything (ADR 0089) |
| Notifications | Tell members about tasks and mentions in the app and by email | Members | User id, notification content without patient data, email address for sends | No | Neon: `notifications`, `notification_preferences`. Email through Resend in production only | Read notifications are deleted 90 days after they are read, unread ones stay. SEC-006 builds the purge. Resend suppression entries are a TODO of SEC-006 ([ADR 0039](../adr/0039-email-through-resend-with-phi-rules.md)) |

## Activities as controller (Article 30(1))

| Activity | Purpose and legal basis | Data subjects | Personal data | Recipients | Retention |
|---|---|---|---|---|---|
| Sign-in and sessions | Secure access to the service. Article 6(1)(b), the contract with the workspace, and 6(1)(f) for security | Every user | IdP subject, email and name at Zitadel, session id hash, user agent, last seen time | Zitadel Cloud, Neon | A session locks after 15 idle minutes and ends after 12 hours by default, both set per workspace ([ADR 0031](../adr/0031-idle-lock-from-explicit-activity.md)). Ended session rows are deleted 30 days after the session ends. SEC-006 builds the purge |
| Platform operation | Run the service for every workspace: operators, emergency grants, legal holds | Operators, members | Operator subject, grant reasons, hold reasons | Neon | 1 year after the grant or hold ends, then deleted. The audit log keeps its own entries under its own retention |
| Abuse protection | Limit login, upload and tile requests per client, and API requests per person and workspace. Article 6(1)(f) | Every visitor | Client IP address at the edge, user, service and workspace ids in Postgres | Cloudflare rate limiting bindings, Neon `rate_counters` | Postgres windows are one minute long and swept after five minutes ([ADR 0088](../adr/0088-rate-limits-in-postgres-and-at-the-edge.md)). Edge counters are held by Cloudflare |
| Errors and telemetry | Find and fix faults. Article 6(1)(f) | Every user | Pseudonymous user id and allow-listed fields only ([ADR 0040](../adr/0040-observability-and-phi-scrubbing.md)) | Sentry and Grafana Cloud, production only | Grafana 14 days. TODO: the Sentry period when the project is created |
| Product analytics | Learn which features help, run experiments. Article 6(1)(f) with an opt-out ([ADR 0171](../adr/0171-analytics-without-device-storage.md)) | Every user | Pseudonymous user id, event names, allow-listed properties | PostHog Cloud, production only, not yet set up | TODO: set when STACK-033 creates the project |

## Transfers

See [subprocessors.md](subprocessors.md#transfers-outside-the-eea). The pilot transfers no real patient data.

## Security measures

Summarised from [controls.md](controls.md): row level security per tenant (IAM-004), patient identifiers sealed per tenant key (SEC-004), a hash chained audit log (SEC-003), encryption in transit and at rest (SEC-002), PHI scrubbing of logs and telemetry (ADR 0040), retention with legal hold (SEC-006), access export and erasure (SEC-007), rate limits (SEC-027) and security headers (SEC-011).

## Keeping this record current

A change that adds a table with personal or phi columns, a new external service or a new purpose updates this page in the same change. The data map test already fails when a column has no class.
