# 0034. Exact-match blind indexes for encrypted patient identifiers, with name search by whole words

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SEC-004, CASES-001, CASES-013, SEC-007

## Context

SEC-004 encrypts patient name, MRN and birth date with tenant data keys ([ADR 0033](0033-envelope-encryption-with-tenant-data-keys.md)) and asks for search through blind indexes or trigram on a tokenised form. Staff look patients up by MRN (exact), by surname and by birth date. Encrypted columns cannot be searched by Postgres, and anything stored for search leaks some information about the value.

## Options considered

1. Trigram blind indexes. An HMAC of every three-letter piece allows partial and fuzzy matches, but a name yields dozens of stored hashes, and their pattern leaks a lot about the name's letters across rows.
2. Whole-word blind indexes. The name is folded (accents removed, lower case) and split into words, and each word is stored as an HMAC. MRN and birth date get one HMAC each. Only equality is revealed, the index is small, and a GIN index on the word array keeps lookups fast. Prefix search ("Nov" finding "Nováková") is lost.
3. Decrypting every patient of the workspace in the API and filtering in memory. No leakage at rest, but it scales with the workspace, not the result.

## Decision

Option 2.

- Each workspace has an index key next to its data keys in `tenant_keys`, wrapped by the master keyring. Blind indexes are the first 16 bytes of HMAC-SHA256 under that key over the field name and the normalised value, so the same MRN in two workspaces gives different indexes, and shredding the keys also kills the indexes.
- Names are normalised by NFKD, dropping combining marks, case folding and splitting on anything that is not a letter or digit. A search matches patients whose name contains every searched word. MRNs drop everything but letters and digits and are upper-cased, and one MRN may appear once per workspace. Birth dates use ISO format.
- Ciphertexts bind the table, field, workspace and patient id as associated data, so a value copied to another patient or column does not decrypt.
- `tenant_keys` is readable and insertable by its workspace, but only the platform scope may update or delete keys, through restrictive policies, so application code in a workspace cannot shred or rewrap keys.
- `parfocal_api.identifiers` holds key loading, rotation, rewrapping, shredding, patient creation, reading and search. SEC-004 creates `patients` with only the encrypted identifiers. CASES-001 adds the rest of the model.

## Consequences

- Searching "Nov" finds nothing. TODO: CASES-013's lookup decides whether the whole-word search is enough in practice or whether a prefix index on surnames is worth its leakage.
- Equal names, MRNs and birth dates in a workspace have equal indexes, which reveals that two patients share them. That is accepted for these fields.
- Changing the index key needs every index rewritten, so the index key has a single version for now. TODO: add versions if a key compromise ever requires it.
- Each request reads and unwraps the workspace's keys, which costs microseconds of crypto and one small query. TODO: cache unwrapped keys per process if CASES-001's load tests show the query matters.
