# 0309. The clinical note returns, sealed

- Date: 2026-11-14
- Status: Accepted
- Deciders: owner, agent
- Backlog: CASES-026

## Context

The case details in the slide picker (CASE-011, case header details) show a clinical note row in clinical projects, but [ADR 0054](0054-hospital-code-inventory-and-revert-order.md) (the hospital code inventory and revert order) removed `cases.clinical_note`, so the row always read "No clinical note". A note is free text written by people, so it often carries names and always describes a patient's health. The owner chose in decision 40a (keep the clinical note row and store it) to bring it back sealed, with a migration, a security review and no PHI in logs.

The alternatives were to drop the row from the picker, to store the note in plain text like specimen site, or to seal it as the patient identifiers are. Plain text is cheap to add and costly to undo, because every backup and replica would then hold readable notes.

## Decision

- Migration 0113 adds `cases.clinical_note_ciphertext` (`bytea`, nullable), classed `phi` in the data map. There is no plain text column and no blind index, because the note is never searched.
- `PUT /api/cases/{case_id}/clinical-note` writes it. Only a project owner with `create-cases` writes, the project must be clinical (a de-identified project answers 400 `de-identified-project`), the text is stripped and capped at 4000 characters, and `null` or blank clears the column.
- `getCase` opens the note only in clinical projects and returns it as `clinical_note`. Reading it writes the existing `case.patient-viewed` audit entry, as reading the patient does.
- The audit entry `case.clinical-note-changed` holds only `{"cleared": true|false}`. The note never goes into audit details, notifications, telemetry or logs.
- Erasing a patient clears the notes of their cases in the same update that unlinks them.

## Security review

- Cipher and library. The note uses the same envelope code as the patient identifiers ([ADR 0033](0033-envelope-encryption-with-tenant-data-keys.md), envelope encryption with tenant data keys): `seal_field` in `parfocal_api.identifiers` over `parfocal_common.envelope`, which is AES-256-GCM from the `cryptography` package with a fresh random 96-bit nonce per write. No new crypto was written.
- Keys. The data key is the tenant's current `data` key from `tenant_keys`, wrapped by the master keyring and loaded per request. A tenant without keys gets them from `ensure_keys` on the first write. Rotation adds a new data key version, and old notes still open because the ciphertext header names its key version. Shredding a tenant's keys makes every note unreadable along with the identifiers.
- Binding. The associated data is the header plus `cases.clinical_note:{tenant_id}:{case_id}`, so a ciphertext copied to another case, another tenant or another column fails to open instead of showing the wrong note.
- Tenant isolation. Row-level security keeps another tenant's case invisible, so a stranger's write and read both answer 404, and the key used is always the caller's own tenant key.
- Logs. The text is registered with `register_sensitive` before anything runs on a write and right after it is opened on a read, so the structured log scrubber replaces it. Validation errors return field locations and messages, never the input, so an over-long note is not echoed. A log capture test checks a write, a read and a refused write.
- What it does not hide. The ciphertext length shows the note's length to anyone with database access, and `updated_at` shows when a note changed. A database reader with the master keys reads every note, as with identifiers. A note on a case without a patient is still audited on read, because the view entry fires when either is present.
- Residual risk. The note is shown to everyone who sees the case, including people with only assigned slides, as the patient name is. Narrowing that is a later product choice.

## Consequences

- The case details show the note in clinical projects, and the fake API serves the scenario's clinical history as the note.
- Any later copy of a case row must reseal the note for the new id, because the context binds it to the case.
