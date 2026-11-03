# Incident and breach register

The record of every security incident and personal data breach, kept under GDPR Art. 33(5) and step 1 of the [incident response runbook](incident-response.md). Every breach goes here, including the ones nobody was told about, with the reason.

Never write PHI, patient names, file names that may name a patient, email addresses or secrets here. Describe data by kind and count. This file sits in a public repository, so an entry for a real breach holds only the ID, the dates, the severity and a pointer to the full record. TODO: the owner chooses a private place for full records before the first tenant with real patient data.

## Entries

No incidents recorded.

## Template

Copy this block under "Entries", newest first.

```
### INC-YYYY-NNN · Short title in plain words

- Status: open, contained, closed
- Severity: SEV1, SEV2 or SEV3, with any change and why
- First notice (UTC):
- Aware of a breach (UTC), which starts the 72 hours:
- Incident lead:
- Environment: production, staging, dev
- Workspaces affected: count, and ids in the private record only
- Data classes affected (data map):
- People affected: categories and approximate count
- Records affected: approximate count
- Parfocal's role: controller, processor, or both

Timeline (UTC, who, what):

- 

Breach assessment:

- Personal data breach under Art. 4(12): yes or no, and why
- Risk to people: none likely, risk, or high risk, and why
- Art. 34(3) exception relied on, if any:

Notifications:

| Who | Sent (UTC) | By | Reference |
|---|---|---|---|
| Workspaces (within the DPA hours) | | | |
| Supervisory authority (within 72 hours) | | | |
| People affected | | | |
| Reason for any delay or for not notifying | | | |

Containment and recovery:

- 

Review (within two weeks of closing):

- Cause:
- What worked:
- What did not:
- Backlog tasks created:
```
