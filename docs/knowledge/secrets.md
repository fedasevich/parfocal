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

Bootstrap writes `parfocal-api-keys` only when it is missing, and it then generates every key in it, the master keyring included. Deleting the secret to get a new value therefore makes every encrypted field of every tenant unreadable. Change single values in the Modal dashboard instead. TODO: editing one value of a Modal secret in the dashboard is untried. SEC-046 (rotation commands for the keys secret) adds a command that does it.

## Master keyring

`MASTER_KEYS` is `id:key` pairs, newest first, and only the small wrapped tenant keys depend on it. The drill in `apps/api/tests/test_key_rotation.py` runs these steps on local Postgres.

1. Prepend a new pair, for example `k2:<32 random bytes in url-safe base64>,k1:<old>`, and redeploy. New tenant keys are wrapped with `k2`, and `k1` still unwraps the old ones.
2. Run `python -m parfocal_api.key_rotation rewrap` with the API's environment, which rewraps every tenant key still under an older master key. Encrypted fields are not touched. TODO: run it through `modal shell` on the deployed `web` function, which has the three secrets, untried.
3. Run `python -m parfocal_api.key_rotation check-retire k1`. It refuses while a tenant key is still wrapped by `k1`, when `k1` is the current key and when a key hangs on a master id that is not listed.
4. Remove `k1` and redeploy.

Removing `k1` before step 3 passes locks every tenant out of its encrypted fields until `k1` is put back. Audit exports signed before the rotation carry the key id `k1`, and `GET` on the audit signing keys stops listing its public key once `k1` is gone. TODO: keep the old public key with the audit evidence before step 4.

## Shared token keys

The API signs tile and room tokens and the Worker checks them, each with a single key. Rotating means writing the new key to the Worker and to `parfocal-api-keys`, then redeploying the API. Tokens signed in between fail until the viewer asks for a fresh one, at most 10 minutes for tiles and 5 minutes for rooms. SEC-047 (an overlap window for session and token keys) lets both sides accept the old key for a while.

## Database role password

`bootstrap --reset-app-role-password` resets the `parfocal_app` password only when `parfocal-api-keys` is missing, so it cannot rotate a working deployment without the trap above. Until SEC-046 lands, set a new password with `ALTER ROLE parfocal_app PASSWORD` as the owner on the direct connection, put the new pooled `DATABASE_URL` into `parfocal-api-keys` in the dashboard and redeploy at once, because the running API loses its connections in between. TODO: untried.
