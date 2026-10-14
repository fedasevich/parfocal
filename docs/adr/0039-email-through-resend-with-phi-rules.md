# 0039. Send email through Resend, with bounce handling and a rule that email never carries PHI

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-036. Touches IAM-007, NOTIF-001 and SEC-006.

## Context

[ADR 0003](0003-pilot-platform-architecture.md) names Resend as the default sender. [ADR 0005](0005-external-sends-only-in-production.md) sends real email only from `prod`, and other environments use the console, file or in-memory senders behind the `EmailSender` interface in `parfocal_common.clients`. [ADR 0030](0030-invitations-bound-to-verified-email.md) already sends invitation links through that interface. What is missing is the provider choice with its data location and BAA position, how bounces and complaints are handled, and what an email may contain.

Pilot volume is not measured. This record assumes a few thousand transactional messages a month (invitations, mentions, STAT assignments, second opinions). TODO: replace with a real estimate once NOTIF-001 knows its event rates.

The central fact is that email travels over the public internet, is stored by the provider and sits in mailboxes. Pathology data is PHI, so the safest design keeps PHI out of email entirely. Then no provider needs a BAA, and the provider is chosen on reliability, webhooks and price.

## Options considered

Facts were checked on 2026-10-14. Entries marked TODO could not be confirmed from an official page.

| | Resend | Amazon SES | Postmark | SendGrid |
|---|---|---|---|---|
| EU data processing | Data is stored in the US. The sending region only changes routing. A pre-signed Article 28 DPA with SCCs and EU-US DPF applies on every plan ([GDPR page](https://resend.com/security/gdpr)) | TODO: confirm per-region storage in the SES docs. Regions exist outside the US | Data is stored in the US. No EU servers planned. DPA with SCCs is available ([EU privacy](https://postmarkapp.com/euprivacy), [GDPR FAQ](https://postmarkapp.com/support/article/1218-gdpr-faq)) | EU residency since 2025, but it needs an EU subuser, EU dedicated IP and the EU endpoint, and reportedly Pro or Premier ([Twilio FAQ](https://www.twilio.com/docs/sendgrid/data-residency/faq)) |
| BAA for HIPAA | No. Resend states it is not HIPAA compliant and cannot sign a BAA ([GDPR page](https://resend.com/security/gdpr)) | Yes. SES has been HIPAA eligible since 2019, under the AWS BAA ([AWS](https://aws.amazon.com/about-aws/whats-new/2019/07/amazon-ses-achieves-hipaa-eligibility)) | TODO: Postmark has an article "Is Postmark HIPAA Compliant?" that was not read | TODO: not confirmed |
| Bounce and complaint webhooks | Yes. `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `suppression.added`. Svix-signed. 8 attempts with backoff, then the endpoint is disabled ([event types](https://resend.com/docs/webhooks/event-types), [verify](https://resend.com/docs/webhooks/verify-webhooks-requests), [retries](https://resend.com/docs/webhooks/retries-and-replays)) | Yes, through SNS topics, which adds an AWS service to run ([SES docs](https://docs.aws.amazon.com/ses/latest/dg/configure-sns-notifications.html)) | TODO: webhook docs not read | TODO: signed Event Webhook not confirmed |
| Price at assumed pilot volume | Free: 3,000 a month, 100 a day, 1 webhook endpoint. Pro: 20 USD for 50,000 a month, 5 endpoints ([pricing](https://resend.com/pricing)) | 0.10 USD per 1,000 sent, plus SNS ([pricing](https://aws.amazon.com/ses/pricing/)) | 15 USD a month for 10,000 on Basic. Free plan is 100 a month ([pricing](https://postmarkapp.com/pricing)) | TODO: not confirmed |
| Other | Idempotency keys on send, kept 24 hours ([docs](https://resend.com/docs/dashboard/emails/idempotency-keys)). Smallest HTTP API | Cheapest at scale. Most set-up work: IAM, domain verification, sandbox exit, SNS | Strong transactional deliverability reputation (vendor claim, not checked) | Twilio account and plan gating for EU |

## Decision

Resend through its HTTP API, in `prod` only, behind the existing `EmailSender` interface. Other environments keep the console, file and memory senders ([ADR 0005](0005-external-sends-only-in-production.md)).

Resend wins because email carries no PHI under the rules below, so the missing BAA and US storage do not block it. It has the smallest set-up, signed webhooks for the events we need and idempotent sends. SES is the fallback. It is the only candidate with a confirmed BAA, and the trigger below moves to it.

### PHI rules

| Rule | Meaning |
|---|---|
| No patient data anywhere in a message | Not in the subject, preheader, body, link text, attachments or sender name. This includes names, dates of birth, accession numbers, case titles, diagnoses, slide labels and free-text comments |
| Links carry opaque values only | A link holds a random token or an id such as a UUID. Never a case number, accession number or patient value. Following it requires sign-in unless it is an invitation token bound to a verified email ([ADR 0030](0030-invitations-bound-to-verified-email.md)) |
| Subjects are fixed text | Examples are "You have been invited to Parfocal" and "New activity needs your attention". A subject may name the workspace, never a case |
| Bodies say that something happened, not what | "A case was assigned to you. Sign in to view it." The detail stays in the app |
| Tenant and person names are allowed | Workspace name and the recipient's own display name are personal data but not PHI. Keep them to what the template needs |
| Templates are rendered server side | From a fixed set of reviewed template files with typed parameters. A template cannot receive a free-text field from a case |
| Templates are reviewed | A change to a template or its parameters needs a reviewer to confirm none of these rules is broken |
| Logs hold no recipient content | The console, file and Resend senders log template name, message id and status. Console and file senders may print the recipient and link outside `prod` only |

Tests: a unit test renders every template with sentinel values for every parameter and fails if a patient-data sentinel can reach the output. An allow-list test fails when a new template or parameter appears without an update to the test. SEC-010 scans the captured outbox of the E2E run.

### Bounce and complaint handling

| Step | Behaviour |
|---|---|
| Endpoint | `POST /api/webhooks/resend` in FastAPI. No session auth. The request is trusted only if the Svix signature verifies against the raw body with the webhook secret, which is a Modal secret. Failures answer 401 and nothing is stored |
| Replay and duplicates | Each event is stored by its `svix-id`. A repeated id is acknowledged and ignored. The handler answers 2xx quickly and does its work in the same transaction |
| Hard bounce, complaint, suppressed | The address is written to a platform-wide suppression list with the reason, the event time and the provider message id. Later sends to it are skipped and recorded as `email.suppressed` in the audit log |
| Soft failure (`delivery_delayed`) | Recorded only. Resend retries by itself. No suppression |
| Failed (`email.failed`) | Recorded. The sender retries only if the error was transient (see below) |
| User state | If the address belongs to a user, the user's email is marked undeliverable. The app shows a banner asking the person to correct their address and tells workspace admins in-app. Notifications for that user fall back to in-app only. A verified change of address or an admin clearing the flag removes the suppression |
| Complaints | Treated as an unsubscribe for non-essential notifications and as a suppression for all email to that address. Security and invitation mail are not marketing and are never added to a bulk list |
| Resend's own list | Resend also suppresses on its side. `suppression.added` and `suppression.removed` events keep our list in step. Our list is the source of truth for whether we try to send |
| Endpoint disabled | Resend disables an endpoint that keeps failing and emails the team. An alert on webhook errors in Sentry and a periodic reconcile job (TODO: spec in NOTIF-001) cover the gap. Missed events can be replayed from the Resend dashboard |

Invitation flow, which builds on [ADR 0030](0030-invitations-bound-to-verified-email.md):

| Situation | Behaviour |
|---|---|
| Address already suppressed when inviting | The invitation is created in state `undeliverable` and no email is sent. The API answers with that state so the admin sees it at once |
| Bounce arrives after sending | The pending invitation is marked `undeliverable` and the admin sees it in the invitation list, with the audit event `invitation.undeliverable` |
| What the admin can do | Withdraw it and invite a corrected address. An invitation is never delivered by another route, because the link is the credential |
| Expiry | Unchanged at 7 days. An undeliverable invitation still expires |
| Acceptance | Unaffected. A person who received the link some other way still needs a verified matching email |

### Retries and idempotency

| Topic | Rule |
|---|---|
| Idempotency key | Every send carries `Idempotency-Key: <template>/<message id>`, where the message id is our own UUID stored with the notification. Resend keeps keys for 24 hours |
| Retried failures | Network errors, 429 and 5xx. Exponential backoff with jitter, stopping before the 24 hour key window ends and recording the message as failed |
| Not retried | Other 4xx responses, such as an invalid address or a rejected domain. They are recorded as failed and the address is treated like a bounce when the error says so |
| Where the send runs | Invitations keep the current inline send for now. NOTIF-001 moves notification email into a background job with the retry rules above. TODO: decide in NOTIF-001 whether an outbox table is needed |
| Known gap | The invitation email is sent before its transaction commits ([ADR 0030](0030-invitations-bound-to-verified-email.md)). It stays until the background job exists |

### Out of scope until production

| Item | Why it waits |
|---|---|
| Creating the Resend account, verifying the sending domain, SPF, DKIM and DMARC records | No cloud changes are allowed now and email is sent only from `prod` |
| The Resend client and the webhook endpoint | Built under the NOTIF and IAM tasks, tested with a signed fixture request and the in-memory fake, never against live Resend from tests |
| Choosing a webhook plan | Free allows 1 endpoint and Pro 5 ([pricing](https://resend.com/pricing)). One endpoint is enough for `prod` |
| Marketing email, digests and unsubscribe pages | Not in pilot scope |
| Inbound email | Not used |
| Deliverability tuning, dedicated IPs | Revisit only if bounce or complaint rates are a problem in the pilot |

### Triggers to move to SES in eu-central-1 or another region

- Any decision to put even indirect PHI in an email, which would need a BAA.
- A customer or regulator requires email data stored in the EU. Resend stores in the US.
- Pilot volume or deliverability outgrows the Resend plans.

A move means a new implementation of `EmailSender` and a new webhook adapter. Templates, the suppression list and the PHI rules stay as they are.

## Consequences

- Email is a notification channel only. Anything a person needs to read about a case is in the app behind sign-in.
- No BAA is needed for email. Resend stores recipient addresses, template names and delivery logs in the US under SCCs and the DPF. Listing Resend as a subprocessor is a task for SEC-006 and the privacy documents. TODO: confirm with the owner before the first pilot tenant signs.
- IAM-007 and NOTIF-001 gain the `undeliverable` state, the suppression list and the webhook endpoint. The invitation templates move from the current code to the reviewed template set.
- Suppression-list entries are personal data. TODO: SEC-006 sets retention and erasure.
- Facts marked TODO in the options table can be filled in if the SES trigger ever fires.
- Sources: [Resend GDPR](https://resend.com/security/gdpr), [Resend pricing](https://resend.com/pricing), [Resend webhooks](https://resend.com/docs/webhooks/introduction), [AWS SES pricing](https://aws.amazon.com/ses/pricing/), [Postmark pricing](https://postmarkapp.com/pricing).
