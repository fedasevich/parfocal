# Data map

Generated from the table models in `apps/api/src/parfocal_api/tables.py` by `pnpm data-map:doc`. Classify a column where it is declared, never on this page. [ADR 0028](../adr/0028-data-classes-on-columns.md) explains the classes.

| Class | Meaning |
|---|---|
| `phi` | Identifies a patient or describes their health. Encrypted or kept out of logs. |
| `personal` | Identifies or describes a staff member, including pseudonymous ids. |
| `secret` | A credential, token or hash of one. Never logged or exported. |
| `operational` | Internal ids, codes, settings and times with no person in them. |
| `public` | Safe to publish. |

| Class | Columns |
|---|---|
| `phi` | 0 |
| `personal` | 17 |
| `secret` | 8 |
| `operational` | 73 |
| `public` | 0 |

## api_tokens

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `service_account_id` | operational |
| `token_hash` | secret |
| `expires_at` | operational |
| `revoked_at` | operational |
| `last_used_at` | operational |
| `created_at` | operational |

## audit_events

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `seq` | operational |
| `occurred_at` | operational |
| `actor_kind` | operational |
| `actor_id` | personal |
| `action` | operational |
| `target_type` | operational |
| `target_id` | personal |
| `details` | operational |
| `prev_hash` | operational |
| `hash` | operational |

## audit_people

| Column | Class |
|---|---|
| `id` | personal |
| `subject` | personal |

## auth_logins

| Column | Class |
|---|---|
| `state_hash` | secret |
| `binding_hash` | secret |
| `code_verifier` | secret |
| `nonce` | secret |
| `return_to` | operational |
| `expires_at` | operational |

## invitations

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `email` | personal |
| `role` | operational |
| `token_hash` | secret |
| `expires_at` | operational |
| `accepted_at` | operational |
| `revoked_at` | operational |
| `created_at` | operational |

## memberships

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `role` | operational |
| `signs_alone` | operational |
| `supervisor_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## organisations

| Column | Class |
|---|---|
| `id` | operational |
| `slug` | operational |
| `name` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## platform_operators

| Column | Class |
|---|---|
| `subject` | personal |
| `created_at` | operational |

## service_accounts

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `name` | operational |
| `scopes` | operational |
| `disabled_at` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## session_policies

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `idle_lock_minutes` | operational |
| `session_hours` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## sessions

| Column | Class |
|---|---|
| `id_hash` | secret |
| `id` | operational |
| `subject` | personal |
| `tokens` | secret |
| `access_expires_at` | operational |
| `expires_at` | operational |
| `last_seen_at` | operational |
| `created_at` | operational |
| `active_tenant_id` | operational |
| `active_at` | operational |
| `user_agent` | personal |

## tenants

| Column | Class |
|---|---|
| `id` | operational |
| `organisation_id` | operational |
| `slug` | operational |
| `name` | operational |
| `kind` | operational |
| `region` | operational |
| `plan` | operational |
| `status` | operational |
| `suspended_at` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## users

| Column | Class |
|---|---|
| `id` | personal |
| `subject` | personal |
| `email` | personal |
| `display_name` | personal |
| `initials` | personal |
| `avatar_colour` | operational |
| `title` | personal |
| `signature` | personal |
| `signature_added_at` | operational |
| `last_tenant_id` | operational |
| `created_at` | operational |
| `updated_at` | operational |
