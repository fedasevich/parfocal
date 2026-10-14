# 0033. Envelope encryption with versioned tenant data keys under a rotating master keyring

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-037, SEC-004, SEC-007, SEC-013, CASES-001

## Context

STACK-037 must define key management, including key rotation and how a tenant's data becomes unreadable after crypto-shredding on erasure. [ADR 0003](0003-pilot-platform-architecture.md) set the default: application-level envelope encryption with per-tenant data keys wrapped by a master key held as a Modal secret, AES-GCM in FastAPI, and a KMS as a trigger before real PHI. The pilot uses fake identities, and work is local only for now. SEC-004 encrypts patient name, MRN and birth date.

## Options considered

1. A cloud KMS now (AWS KMS, GCP KMS, Cloudflare has none). Strong custody and audit, but a new cloud account, network calls on cache misses, and cloud access is paused.
2. HashiCorp Vault or OpenBao. A transit engine gives the same envelope model, but it is one more always-on service to run, back up and unseal.
3. Envelope encryption in the application with the master key from a secret. Nothing new to run. The master key's custody is only as good as the secret store, which is acceptable for fake identities and must change before real PHI.

## Decision

Option 3, shaped so a KMS can replace the keyring without touching stored data.

- `MASTER_KEYS` holds `id:key` pairs, 32-byte url-safe base64 keys, newest first. The first is current. `parfocal_common.envelope.MasterKeyring` wraps with the current key and unwraps with any listed key.
- Each tenant has data keys with versions. A data key is 32 random bytes, wrapped with AES-GCM under the master key, with the tenant id and version as associated data, so a wrapped key cannot be moved to another tenant or version.
- A field is `format (1 byte) | data-key version (2 bytes) | nonce (12) | AES-GCM ciphertext and tag`. The associated data is the header plus a context naming the table, column and tenant, so a value cannot be copied into another column or tenant and still decrypt.
- Master-key rotation: add the new key first in `MASTER_KEYS`, rewrap every tenant's data keys with `rewrap` (only the small wrapped keys change), then remove the old key. Data stays untouched.
- Data-key rotation: add a new version for a tenant. New writes use it, reads look up the version from the header, and a background job rewrites old values and then deletes the old version.
- Crypto-shredding: deleting a tenant's wrapped data keys makes every encrypted field unreadable (`DataKeyUnavailableError`). The spike's numbers are in [results/2026-10-14-envelope-encryption-spike.md](../results/2026-10-14-envelope-encryption-spike.md).

## Consequences

- Encrypting or decrypting a field costs about 2 µs on an M4, so performance does not shape the design.
- Erasure through shredding only covers encrypted columns. Plain columns and search indexes must be deleted or derived from keys that are shredded too. SEC-004's blind indexes therefore use a per-tenant index key stored and destroyed with the data keys.
- Backups keep the wrapped keys until the backup expires, so shredded data stays recoverable from a backup for the backup retention period. TODO: SEC-014 and SEC-006 must state that period, and SEC-007 must tell the requester.
- Shredding is per tenant. Erasing one patient means deleting their rows. TODO: SEC-007 decides whether per-patient keys are needed.
- Before real PHI: TODO: move the master key into a KMS (the trigger in ADR 0003) by implementing `wrap` and `unwrap` against it. Stored wrapped keys are rewrapped once.
- STACK-037's other part, where runtime secrets live, stays as ADR 0003 says (Modal secrets, Wrangler secrets, GitHub environments) and is checked by SEC-013.
