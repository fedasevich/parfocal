# Result: a master key rotation keeps two tenants readable and leaves their encrypted fields untouched, drilled locally

- Date: 2026-11-15
- Backlog: SEC-013 (secrets management in all environments)
- Kind: check
- Commit: the SEC-013 commit, measured from the working tree on top of 75111e47
- Environment: MacBook with an Apple M4, local Postgres and the pooler from `compose.yaml`, Python 3.14. No cloud resource was used, cost $0
- Data: two made-up tenants, one made-up patient each, random master keys made in the test

## Question

Does the procedure in [knowledge/secrets.md](../knowledge/secrets.md#master-keyring) rotate the master keyring without touching stored data or locking a tenant out, and does `check-retire` stop the one unsafe step?

## Method

1. `uv run --package parfocal-api pytest tests/test_key_rotation.py -q -s -m "db or not db"` from `apps/api`. The drill test makes its own migrated database, so keys of other tests cannot mix in.
2. The drill writes both patients under `m1`, switches to `m2,m1`, runs `parfocal_api.key_rotation.run` with `status`, then `rewrap`, then checks the retirement of `m1`, and reads both patients with `m2` alone.

## Results

| Step | Seen |
|---|---|
| Tenant keys under `m1` before the rewrap | 4, a data key and an index key per tenant |
| `check-retire m1` before the rewrap | refused, 4 tenant keys still wrapped by `m1` |
| Rewrap of the 4 keys | 22 ms, one run |
| Tenant keys under `m1` after the rewrap | 0, and `check-retire m1` passes |
| Patient ciphertexts after the rewrap | byte for byte the same as before |
| Reads with `m2` alone | both patients read back |
| Reads with `m1` alone after the rewrap | refused with `UnknownMasterKeyError` |
| Reads with a new key before any rewrap | refused with `UnknownMasterKeyError`, so dropping the old key first locks the tenant out |
| A session sealed with the old `SESSION_KEY` | does not open under a new one (`InvalidTag`), which the session lookup treats as signed out |

## Conclusion

The master keyring rotates with no downtime and no data rewrite, and the retirement check catches the step that would lock tenants out. This is a local drill against Postgres in Docker, not the drill environment of [ADR 0331](../adr/0331-no-staging-environment.md) (no staging environment). TODO: repeat it there, on a short-lived Neon branch of production with a separate Modal environment, before the first real user.
