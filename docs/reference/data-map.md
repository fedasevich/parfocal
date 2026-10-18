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
| `phi` | 20 |
| `personal` | 27 |
| `secret` | 9 |
| `operational` | 277 |
| `public` | 0 |

## annotation_versions

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `annotation_id` | operational |
| `version` | operational |
| `change` | operational |
| `geometry` | operational |
| `class_id` | operational |
| `changed_by_user_id` | personal |
| `changed_at` | operational |

## annotations

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `slide_id` | operational |
| `kind` | operational |
| `number` | operational |
| `geometry` | operational |
| `class_id` | operational |
| `version` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

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

## blocks

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `case_id` | operational |
| `specimen_id` | operational |
| `number` | operational |
| `description` | phi |
| `stains` | operational |
| `levels` | operational |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## case_requests

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `user_id` | personal |
| `request_key` | operational |
| `case_id` | operational |
| `created_at` | operational |

## cases

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `patient_id` | operational |
| `label` | phi |
| `source` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## class_mappings

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `source_name` | operational |
| `class_id` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## emergency_grants

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `project_id` | operational |
| `privacy_mode` | operational |
| `reason` | phi |
| `granted_at` | operational |
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

## job_steps

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `job_id` | operational |
| `ordinal` | operational |
| `name` | operational |
| `status` | operational |
| `runs` | operational |
| `result` | operational |
| `started_at` | operational |
| `finished_at` | operational |

## job_units

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `job_id` | operational |
| `ordinal` | operational |
| `unit` | operational |
| `worker` | operational |
| `done_at` | operational |

## jobs

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `kind` | operational |
| `status` | operational |
| `input` | operational |
| `claimed_by` | operational |
| `claims` | operational |
| `lease_until` | operational |
| `error_code` | operational |
| `created_at` | operational |
| `finished_at` | operational |

## memberships

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `role` | operational |
| `availability` | operational |
| `available_again_at` | operational |
| `availability_note` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## notification_preferences

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `user_id` | personal |
| `kind` | operational |
| `in_app` | operational |
| `email` | operational |
| `realtime` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## notifications

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `kind` | operational |
| `target_type` | operational |
| `target_id` | operational |
| `payload` | operational |
| `in_app` | operational |
| `realtime` | operational |
| `email_status` | operational |
| `emailed_at` | operational |
| `read_at` | operational |
| `created_at` | operational |

## opinion_forms

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `version` | operational |
| `questions` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |

## organisations

| Column | Class |
|---|---|
| `id` | operational |
| `slug` | operational |
| `name` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## patients

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `privacy_mode` | operational |
| `name_ciphertext` | phi |
| `name_tokens` | phi |
| `mrn_ciphertext` | phi |
| `mrn_index` | phi |
| `birth_date_ciphertext` | phi |
| `birth_date_index` | phi |
| `sex` | phi |
| `age_years` | phi |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## platform_operators

| Column | Class |
|---|---|
| `subject` | personal |
| `created_at` | operational |

## project_classes

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `key` | operational |
| `name` | operational |
| `colour` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## project_members

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `user_id` | personal |
| `role` | operational |

## projects

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `number` | operational |
| `name` | operational |
| `privacy_mode` | operational |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |
| `colour` | operational |
| `template` | operational |
| `archived_at` | operational |
| `created_by_user_id` | personal |

## result_chunks

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `result_set_id` | operational |
| `chunk` | operational |
| `x` | operational |
| `y` | operational |
| `width` | operational |
| `height` | operational |
| `cell_count` | operational |
| `vertex_count` | operational |
| `object_key` | operational |

## result_objects

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `result_set_id` | operational |
| `kind` | operational |
| `number` | operational |
| `geometry` | operational |
| `class_index` | operational |
| `score` | operational |
| `probabilities` | operational |
| `parent_number` | operational |

## result_set_classes

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `result_set_id` | operational |
| `position` | operational |
| `source_name` | operational |
| `class_id` | operational |
| `object_count` | operational |

## result_sets

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `slide_id` | operational |
| `name` | operational |
| `model_version` | operational |
| `source` | operational |
| `source_file` | phi |
| `produced_at` | operational |
| `status` | operational |
| `error_code` | operational |
| `cell_count` | operational |
| `region_count` | operational |
| `zone_count` | operational |
| `job_id` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

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
| `emergency_hours` | operational |
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

## slide_counters

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `slide_id` | operational |
| `letter` | operational |
| `last` | operational |

## slides

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `case_id` | operational |
| `block_id` | operational |
| `label` | phi |
| `barcode` | phi |
| `stain` | operational |
| `level` | operational |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## specimens

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `case_id` | operational |
| `letter` | operational |
| `type` | phi |
| `site` | phi |
| `laterality` | phi |
| `procedure` | phi |
| `collected_at` | phi |
| `received_at` | phi |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## tenant_keys

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `purpose` | operational |
| `version` | operational |
| `master_id` | operational |
| `wrapped_key` | secret |
| `created_at` | operational |

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
| `last_tenant_id` | operational |
| `created_at` | operational |
| `updated_at` | operational |
