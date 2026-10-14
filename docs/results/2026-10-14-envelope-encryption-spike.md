# Result: Envelope encryption with tenant data keys in Python

- Date: 2026-10-14
- Backlog: STACK-037
- Kind: spike
- Commit: e027071 plus the uncommitted `parfocal_common.envelope` module and its tests, committed with STACK-037
- Environment: Apple M4, macOS 15.8.1, CPython 3.14.7, `cryptography` 50.0.2 (AES-GCM through OpenSSL), one process, no other load
- Data: a made-up 13-character name with two non-ASCII letters, no PHI

## Question

Can the default of [ADR 0003](../adr/0003-pilot-platform-architecture.md), application-level envelope encryption with per-tenant data keys wrapped by a master key, support master-key rotation, data-key rotation and crypto-shredding, and what does it cost per field? No budget exists for field encryption. The comparison is with API request budgets of tens of milliseconds.

## Method

1. `packages/py-common/src/parfocal_common/envelope.py` implements the keyring, wrapping and the field format. `packages/py-common/tests/test_envelope.py` (13 tests) checks round trips, context binding, tampering, master rotation, data-key rotation, shredding and malformed settings. Run with `uv run pytest packages/py-common/tests/test_envelope.py`.
2. A scratch script timed 100,000 calls of each operation, 5 rounds, and took the median per call. It was run three times. The script is not committed. It calls `encrypt(key, value, context)`, `decrypt({1: key}, ciphertext, context)` and `keyring.unwrap("t", 1, wrapped)` in a loop with `time.perf_counter`.

## Results

| Run | Encrypt one field (µs) | Decrypt one field (µs) | Unwrap a data key (µs) |
|---|---|---|---|
| 1 | 1.86 | 1.38 | 1.33 |
| 2 | 1.84 | 1.36 | 1.37 |
| 3 | 1.88 | 1.34 | 1.36 |

| Plaintext bytes | Ciphertext bytes |
|---|---|
| 15 | 46 |

The overhead is 31 bytes per field: a 3-byte header (format and data-key version), a 12-byte nonce and a 16-byte tag.

All 13 tests passed.

## Interpretation

- The cost is negligible for a page of patients. 100 encrypted fields cost about 0.2 ms to decrypt on this machine. Assumption: Modal's CPUs are slower than an M4, but not by orders of magnitude.
- Unwrapping is as cheap as decrypting, so the key cache only saves the database read of the wrapped key, not crypto time.
- Shredding works as designed: without the data key, a ciphertext cannot be read, and a different key of the same version fails the tag check.

## Follow-ups

- [ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md) records the design.
- SEC-004 adds the `tenant_keys` table, the column type and blind indexes on top of this module.
