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
| `phi` | 46 |
| `personal` | 91 |
| `secret` | 11 |
| `operational` | 739 |
| `public` | 0 |

## adjudication_objects

| Column | Class |
|---|---|
| `adjudication_id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `kind` | operational |
| `number` | operational |

## adjudications

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `adjudicator_user_id` | personal |
| `sent_by_user_id` | personal |
| `note` | phi |
| `sent_at` | operational |
| `declined_at` | operational |
| `declined_note` | phi |

## annotation_versions

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `annotation_id` | operational |
| `version` | operational |
| `change` | operational |
| `geometry` | operational |
| `class_id` | operational |
| `text` | phi |
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
| `text` | phi |
| `task_id` | operational |
| `version` | operational |
| `origin` | operational |
| `source_number` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |

## announcements

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `kind` | operational |
| `text` | operational |
| `ends_at` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

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
| `label_lower` | phi |
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

## clinical_deposits

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `report_id` | operational |
| `slide_id` | operational |
| `object_id` | operational |
| `size_mm` | operational |
| `note` | phi |
| `created_at` | operational |
| `updated_at` | operational |

## clinical_report_versions

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `report_id` | operational |
| `number` | operational |
| `content` | phi |
| `reason` | phi |
| `signed_by_user_id` | personal |
| `reported_by_user_id` | personal |
| `signed_at` | operational |

## clinical_reports

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `case_id` | operational |
| `template` | operational |
| `template_version` | operational |
| `state` | operational |
| `specimen` | phi |
| `category` | operational |
| `confirmed_against` | operational |
| `nodes_examined` | operational |
| `extranodal` | operational |
| `diagnosis` | phi |
| `microscopic` | phi |
| `comment` | phi |
| `cosigner_user_id` | personal |
| `sent_by_user_id` | personal |
| `sent_content` | phi |
| `sent_at` | operational |
| `return_note` | phi |
| `version` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## disagreement_decisions

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `kind` | operational |
| `number` | operational |
| `decision` | operational |
| `style` | operational |
| `answer` | operational |
| `answer_class_id` | operational |
| `value` | operational |
| `left_open` | operational |
| `edits_settled_at` | operational |
| `note` | phi |
| `decided_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## display_choices

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `task_id` | operational |
| `user_id` | personal |
| `preset_id` | personal |
| `settings` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## display_presets

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `task_id` | operational |
| `name` | personal |
| `settings` | personal |
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

## evaluation_changes

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `version` | operational |
| `slide_id` | operational |
| `object_id` | operational |
| `change` | operational |
| `reason` | phi |
| `changed_by_user_id` | personal |
| `changed_at` | operational |

## evaluation_versions

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `number` | operational |
| `reason` | phi |
| `started_by_user_id` | personal |
| `started_at` | operational |
| `signed_at` | operational |
| `signed_by_user_id` | personal |
| `confirmed_with` | operational |
| `checksum` | operational |
| `evaluation` | operational |
| `blocks` | operational |
| `format` | operational |

## gpu_usage

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `job_id` | operational |
| `kind` | operational |
| `model` | operational |
| `model_version` | operational |
| `tier` | operational |
| `gpu` | operational |
| `worker` | operational |
| `seconds` | operational |
| `recorded_at` | operational |

## hidden_models

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `model_name` | operational |
| `hidden_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## invitations

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `email` | personal |
| `role` | operational |
| `admin_rights` | operational |
| `token_hash` | secret |
| `task_id` | operational |
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
| `units_total` | operational |
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
| `seq` | operational |
| `result` | operational |

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
| `tries` | operational |
| `lease_until` | operational |
| `error_code` | operational |
| `pause_reason` | operational |
| `created_at` | operational |
| `finished_at` | operational |

## lab_model_projects

| Column | Class |
|---|---|
| `lab_model_id` | operational |
| `project_id` | operational |
| `tenant_id` | operational |

## lab_models

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `name` | operational |
| `version` | operational |
| `address` | operational |
| `sign_in` | operational |
| `header_name` | operational |
| `secret_ciphertext` | secret |
| `secret_last_four` | operational |
| `tile_size` | operational |
| `magnification` | operational |
| `taxonomy` | operational |
| `class_map` | operational |
| `who_can_run` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## legal_holds

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `reason` | personal |
| `placed_by_user_id` | personal |
| `released_at` | operational |
| `released_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## memberships

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `role` | operational |
| `admin_rights` | operational |
| `availability` | operational |
| `available_again_at` | operational |
| `availability_note` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## model_runs

| Column | Class |
|---|---|
| `job_id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `slide_id` | operational |
| `task_id` | operational |
| `batch_id` | operational |
| `scope_kind` | operational |
| `scope` | operational |
| `detector` | operational |
| `detector_version` | operational |
| `typer` | operational |
| `typer_version` | operational |
| `test_time_views` | operational |
| `ordering` | operational |
| `tier` | operational |
| `started_by_user_id` | personal |
| `created_at` | operational |

## model_tiers

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task` | operational |
| `tier` | operational |
| `model_name` | operational |
| `model_version` | operational |
| `set_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## notification_mutes

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `user_id` | personal |
| `subject` | operational |
| `subject_id` | operational |
| `created_at` | operational |

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
| `project_id` | operational |
| `task_id` | operational |
| `case_id` | operational |
| `muted` | operational |

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

## opinions

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `form_version` | operational |
| `answers` | phi |
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

## personal_settings

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `user_id` | personal |
| `values` | personal |
| `updated_at` | operational |

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
| `sign_out` | operational |

## projects

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `number` | operational |
| `name` | operational |
| `name_lower` | operational |
| `privacy_mode` | operational |
| `created_at` | operational |
| `updated_at` | operational |
| `deleted_at` | operational |
| `colour` | operational |
| `template` | operational |
| `archived_at` | operational |
| `created_by_user_id` | personal |
| `sample` | operational |
| `clinical_template` | operational |
| `blinded` | operational |
| `ai_hidden_first_read` | operational |
| `study_template_id` | operational |
| `match_iou` | operational |
| `match_distance_um` | operational |

## rate_counters

| Column | Class |
|---|---|
| `key` | personal |
| `window_start` | operational |
| `count` | operational |

## report_links

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `token_hash` | secret |
| `created_by_user_id` | personal |
| `expires_at` | operational |
| `revoked_at` | operational |
| `opened_count` | operational |
| `last_opened_at` | operational |
| `created_at` | operational |

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

## resume_states

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `user_id` | personal |
| `task_id` | operational |
| `slide_id` | operational |
| `mode` | personal |
| `object_id` | personal |
| `camera` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## retention_policies

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `deleted_after_days` | operational |
| `audit_after_days` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## review_assignments

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `submitted_at` | operational |
| `assigned_at` | operational |
| `first_read_at` | operational |
| `first_read` | phi |
| `released_at` | operational |
| `nothing_to_mark` | operational |

## review_decisions

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `kind` | operational |
| `number` | operational |
| `value` | operational |
| `style` | operational |
| `answer` | operational |
| `answer_class_id` | operational |
| `reasons` | operational |
| `reason_class_id` | operational |
| `note` | phi |
| `reopened_at` | operational |
| `reopened_note` | phi |
| `preset` | personal |
| `ai_class_id` | operational. The AI call at decision time, read from the result set for a region and reported by the reviewer's client for a cell, unchecked against the cell chunks |
| `ai_score` | operational. The AI call at decision time, read from the result set for a region and reported by the reviewer's client for a cell, unchecked against the cell chunks |
| `created_at` | operational |
| `updated_at` | operational |

## review_edits

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `kind` | operational |
| `number` | operational |
| `split` | operational |
| `class_id` | operational |
| `geometry` | operational |
| `deleted` | operational |
| `retired` | operational |
| `merged_into_number` | operational |
| `merged_into_split` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## review_order

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `seed` | operational |
| `count` | operational |
| `objects` | operational |
| `created_at` | operational |

## review_skips

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `kind` | operational |
| `number` | operational |
| `ai_class_id` | operational. The AI call at decision time, read from the result set for a region and reported by the reviewer's client for a cell, unchecked against the cell chunks |
| `ai_score` | operational. The AI call at decision time, read from the result set for a region and reported by the reviewer's client for a cell, unchecked against the cell chunks |
| `created_at` | operational |
| `updated_at` | operational |

## review_task_slides

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `position` | operational |
| `kind` | operational |
| `result_set_id` | operational |
| `run_set_ids` | operational |
| `signed_off_at` | operational |
| `signed_off_by_user_id` | personal |

## review_tasks

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `number` | operational |
| `name` | operational |
| `kind` | operational |
| `class_snapshot` | operational |
| `split` | operational |
| `scope` | operational |
| `scope_count` | operational |
| `scope_seed` | operational |
| `scope_score` | operational |
| `extra_scopes` | operational |
| `opinion_form_version` | operational |
| `blinded` | operational |
| `ai_hidden_first_read` | operational |
| `start_mode` | operational |
| `due_on` | operational |
| `reminder_days` | operational |
| `created_by_user_id` | personal |
| `archived_at` | operational |
| `signed_off_at` | operational |
| `signed_off_by_user_id` | personal |
| `study_template_id` | operational |
| `study_template_version` | operational |
| `decision_style` | operational |
| `counts_as` | operational |
| `counts_as_changes` | personal |
| `question` | operational |
| `display` | operational |
| `check_options` | operational |
| `blind_first` | operational |
| `blind_first_since` | operational |
| `report_layout` | operational |
| `created_at` | operational |
| `updated_at` | operational |

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

## site_validations

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `model_name` | operational |
| `model_version` | operational |
| `specimen_type` | operational |
| `threshold` | operational |
| `true_positives` | operational |
| `false_positives` | operational |
| `true_negatives` | operational |
| `false_negatives` | operational |
| `announcement_id` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## slide_counters

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `slide_id` | operational |
| `letter` | operational |
| `last` | operational |

## slide_coverage

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `slide_id` | operational |
| `user_id` | personal |
| `cell` | operational |
| `columns` | operational |
| `rows` | operational |
| `seen` | personal |
| `seen_cells` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## slides

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `case_id` | operational |
| `block_id` | operational |
| `label` | phi |
| `label_lower` | phi |
| `barcode` | phi |
| `stain` | operational |
| `level` | operational |
| `position` | operational |
| `upload_id` | operational |
| `format` | operational |
| `variant` | operational |
| `reader` | operational |
| `width` | operational |
| `height` | operational |
| `level_count` | operational |
| `mpp_x` | operational |
| `mpp_y` | operational |
| `objective_power` | operational |
| `notices` | operational |
| `file_bytes` | operational |
| `sha256` | operational |
| `original_key` | operational |
| `restricted_images` | operational |
| `published_at` | operational |
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

## stage_throughput

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `job_id` | operational |
| `ordinal` | operational |
| `run` | operational |
| `kind` | operational |
| `stage` | operational |
| `model` | operational |
| `model_version` | operational |
| `tier` | operational |
| `machine` | operational |
| `worker` | operational |
| `units` | operational |
| `seconds` | operational |
| `finished_at` | operational |

## study_template_versions

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `template_id` | operational |
| `version` | operational |
| `name` | operational |
| `study_kind` | operational |
| `blocks` | operational |
| `format` | operational |
| `presets` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |

## study_templates

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `built_in` | operational |
| `version` | operational |
| `retired_at` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

## task_nudges

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `user_id` | personal |
| `sent_by_user_id` | personal |
| `sent_at` | operational |

## task_reassignments

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `task_id` | operational |
| `from_user_id` | personal |
| `to_user_id` | personal |
| `what` | operational |
| `slide_ids` | operational |
| `kept_slide_ids` | operational |
| `created_at` | operational |
| `undone_at` | operational |

## template_offers

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `name` | operational |
| `study_kind` | operational |
| `blocks` | operational |
| `format` | operational |
| `presets` | operational |
| `offered_by_user_id` | personal |
| `status` | operational |
| `template_id` | operational |
| `decided_at` | operational |
| `decided_by_user_id` | personal |
| `created_at` | operational |
| `updated_at` | operational |

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
| `email_domain` | operational |
| `join_policy` | operational |
| `logo` | operational |
| `logo_colour` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## thread_messages

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `thread_id` | operational |
| `user_id` | personal |
| `body` | phi |
| `created_at` | operational |

## threads

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `task_id` | operational |
| `slide_id` | operational |
| `title` | phi |
| `anchor_kind` | operational |
| `object_id` | operational |
| `geometry` | operational |
| `offset_x` | operational |
| `offset_y` | operational |
| `result_set_id` | operational |
| `created_by_user_id` | personal |
| `created_at` | operational |
| `resolved_at` | operational |
| `resolved_by_user_id` | personal |

## uploads

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `project_id` | operational |
| `case_id` | operational |
| `created_by_user_id` | personal |
| `created_by_service_id` | operational |
| `file_name` | phi |
| `size_bytes` | operational |
| `last_modified_ms` | operational |
| `object_key` | phi |
| `storage_upload_id` | operational |
| `part_bytes` | operational |
| `part_count` | operational |
| `status` | operational |
| `etag` | operational |
| `job_id` | operational |
| `last_activity_at` | operational |
| `closed_at` | operational |
| `kind` | operational |
| `result_format` | operational |
| `slide_id` | operational |
| `slide_upload_id` | operational |
| `pairing_rule` | operational |
| `pairing_certainty` | operational |
| `result_set_id` | operational |
| `import_problems` | operational |
| `import_choices` | operational |
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
| `specialties` | personal |
| `email_digest` | operational |
| `quiet_from` | operational |
| `quiet_until` | operational |
| `time_zone` | operational |
| `last_tenant_id` | operational |
| `created_at` | operational |
| `updated_at` | operational |

## workspace_access_requests

| Column | Class |
|---|---|
| `id` | operational |
| `tenant_id` | operational |
| `user_id` | personal |
| `status` | operational |
| `asked_at` | operational |
| `decided_at` | operational |
| `decided_by_user_id` | personal |

## workspace_settings

| Column | Class |
|---|---|
| `tenant_id` | operational |
| `values` | operational |
| `locked` | operational |
| `security_contact` | personal |
| `updated_at` | operational |
