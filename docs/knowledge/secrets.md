# Secrets

Where every runtime secret lives, who writes it and how to rotate it. Source: SEC-013 (secrets management in all environments), [ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md) (envelope encryption with tenant data keys) and the [local rotation drill](../results/2026-11-15-secret-rotation-local-drill.md).

## No secret in the repository

`pnpm secrets` runs betterleaks over the whole git history with `.betterleaks.toml`, and the `lint` job in `ci.yml` runs it on every pull request with `fetch-depth: 0`. The config is passed by name, because betterleaks 1.10.1 from Homebrew did not pick `.betterleaks.toml` up on its own in a worktree on 2026-11-15 and reported 19 made-up test passwords. CI pins 1.9.0, and the lefthook pre-commit hook passes the config the same way. Every allowlist entry names the file and the made-up value with a reason. Never allowlist a real value. Rotate it and rewrite nothing, since pushed history stays.

## Inventory

Deployed code reads secrets only from its environment, which Modal fills from the three secrets in `parfocal_deploy.modal_app.SECRETS` and Cloudflare from Worker secrets. `workers/deploy/tests/test_secret_inventory.py` fails when a `SecretStr` setting, a bootstrap value, a Worker secret or a workflow `secrets.` reference is missing from this table, when a row has no rotation step, and when `wrangler.jsonc` or a workflow `env:` holds a literal secret. Production refuses to start on the local storage secret. The production clients for email, errors and analytics take no key yet, so add their rows when they do.

| Secret | Store | Written by | Rotation |
|---|---|---|---|
| `MASTER_KEYS` | Modal `parfocal-api-keys` | bootstrap, once | [Master keyring](#master-keyring), no downtime |
| `SESSION_KEY` | Modal `parfocal-api-keys` | bootstrap, once | Replace and redeploy. Sealed session tokens fail to open, so everyone is signed out once |
| `TILE_TOKEN_KEY` | Modal `parfocal-api-keys` and the Worker | bootstrap, once | [Shared token keys](#shared-token-keys) |
| `ROOM_TOKEN_KEY` | Modal `parfocal-api-keys` and the Worker | bootstrap, once | [Shared token keys](#shared-token-keys) |
| `DATABASE_URL` | Modal `parfocal-api-keys` | bootstrap, once | [Database role password](#database-role-password) |
| `ZITADEL_CLIENT_SECRET` | Modal `parfocal-api-config` | bootstrap from the OpenTofu output | Regenerate the client secret through the identity module, rerun bootstrap, which always rewrites the config secret, then redeploy |
| `STORAGE_SECRET_ACCESS_KEY` | Modal `parfocal-api-config` | bootstrap from `R2_SECRET_ACCESS_KEY` | Make a new R2 token, rerun bootstrap with it in the shell, redeploy, update the GitHub copies, then delete the old token |
| `ZITADEL_LOGIN_TOKEN` | Modal `parfocal-api-login` | the owner by hand | Make a new personal access token for the login service user, replace it in the secret, redeploy, then delete the old token in Zitadel |
| `MODAL_PROXY_TOKEN_ID` | the Worker | bootstrap from the shell | Make a new proxy auth token in the Modal dashboard, write both halves to the Worker, then delete the old token |
| `MODAL_PROXY_TOKEN_SECRET` | the Worker | bootstrap from the shell | Rotates with `MODAL_PROXY_TOKEN_ID` |
| `TURNSTILE_SECRET_KEY` | the Worker | bootstrap when set in the shell | Rotate the widget secret in the Cloudflare dashboard and write it to the Worker |
| `NEON_API_KEY` | GitHub environment `production` and the owner's shell | the owner by hand | Make a new key in the Neon console, replace the GitHub secret, then revoke the old key |
| `R2_ACCESS_KEY_ID` | GitHub environment `production` and the owner's shell | the owner by hand | Rotates with `STORAGE_SECRET_ACCESS_KEY` |
| `R2_SECRET_ACCESS_KEY` | GitHub environment `production` and the owner's shell | the owner by hand | Rotates with `STORAGE_SECRET_ACCESS_KEY` |
| `CLOUDFLARE_API_TOKEN` | GitHub environment `production` | the owner by hand | Roll the token in the Cloudflare dashboard and replace the GitHub secret |
| `MODAL_TOKEN_ID` | GitHub environment `production` | the owner by hand | Make a new Modal token, replace both GitHub secrets, then revoke the old token |
| `MODAL_TOKEN_SECRET` | GitHub environment `production` | the owner by hand | Rotates with `MODAL_TOKEN_ID` |
| `PARFOCAL_SMOKE_PASSWORD` | GitHub environment `production` | the owner by hand | Change the smoke account's password in Zitadel and replace the GitHub secret |
| `SEED_OWNER_EMAIL` | GitHub environment `production` | the owner by hand | Not a credential, kept secret because it is personal data. Replace it when the owner's address changes |

Every rotation of a production secret is asked in chat first, as [ADR 0151](../adr/0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month) says.

## Never delete `parfocal-api-keys` to rotate

Bootstrap writes `parfocal-api-keys` only when it is missing, and it then generates every key in it, the master keyring included. Deleting the secret to get a new value therefore makes every encrypted field of every tenant unreadable. Change single values with `pnpm --filter @parfocal/deploy rotate`, whose commands take only names and key ids, generate the new value themselves and merge it into the secret with `modal.Secret.update`, which keeps every other value. They refuse when the secret is missing, so they never create half of it. `workers/deploy/tests/test_rotate.py` checks against fakes that each command keeps the other values and that no secret reaches a command line. TODO: no command has run against real Modal yet, and every production rotation is still asked first.

| Command | Changes |
|---|---|
| `add-master-key` | Prepends the next `kN` to `MASTER_KEYS` |
| `rewrap` | Rewraps tenant keys under the current master key, nothing in the secret |
| `retire-master-key k1` | Removes `k1` from `MASTER_KEYS` only after `check-retire` passes |
| `replace-key SESSION_KEY` | `SESSION_KEY` in the secret |
| `replace-key TILE_TOKEN_KEY` or `ROOM_TOKEN_KEY` | That key in the Worker through `wrangler secret bulk` on stdin, then in the secret |
| `reset-app-password` | The `parfocal_app` password on the direct owner connection, then `DATABASE_URL` |

Every command that changes the secret needs a redeploy afterwards. `rewrap` and `retire-master-key` read the stored keyring and the tenant key counts in a short-lived Modal app, `parfocal-key-rotation`, which mounts the three API secrets and returns only `MASTER_KEYS` and the counts.

## Master keyring

`MASTER_KEYS` is `id:key` pairs, newest first, and only the small wrapped tenant keys depend on it. The drill in `apps/api/tests/test_key_rotation.py` runs these steps on local Postgres.

1. Run `rotate add-master-key`, which makes `MASTER_KEYS` `k2:<new>,k1:<old>`, and redeploy. New tenant keys are wrapped with `k2`, and `k1` still unwraps the old ones.
2. Run `rotate rewrap`, which runs `python -m parfocal_api.key_rotation rewrap` in the API's environment and rewraps every tenant key still under an older master key. Encrypted fields are not touched.
3. Run `rotate retire-master-key k1`. It runs the `check-retire` rules first and refuses while a tenant key is still wrapped by `k1`, when `k1` is the current key and when a key hangs on a master id that is not listed. Only then does it remove `k1`.
4. Redeploy.

Removing `k1` before step 3 passes locks every tenant out of its encrypted fields until `k1` is put back. Audit exports signed before the rotation carry the key id `k1`, and `GET` on the audit signing keys stops listing its public key once `k1` is gone. TODO: keep the old public key with the audit evidence before step 4.

## Shared token keys

The API signs tile and room tokens and the Worker checks them, each with a single key. Rotating means `rotate replace-key TILE_TOKEN_KEY` or `ROOM_TOKEN_KEY`, which writes the new key to the Worker and to `parfocal-api-keys`, then redeploying the API. Tokens signed in between fail until the viewer asks for a fresh one, at most 10 minutes for tiles and 5 minutes for rooms. SEC-049 (an overlap window for session and token keys) lets both sides accept the old key for a while.

## Database role password

`bootstrap --reset-app-role-password` resets the `parfocal_app` password only when `parfocal-api-keys` is missing, so it cannot rotate a working deployment without the trap above. Run `rotate reset-app-password` with `NEON_API_KEY` and `NEON_PROJECT_ID` in the shell instead. It sets a new password as the owner on the direct connection and merges the new pooled `DATABASE_URL`. Redeploy at once, because the running API loses its connections in between. If it fails between the two steps, run it again, since each run makes a fresh password and writes both.
