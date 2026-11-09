# 0270. The settings schema: every setting has one scope, a default, and a place that stores it, and the mock rows with no key yet are planned

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SET-000 (settings research check). Touches SET-012 (idea: home and worklist choice)

## Context

The settings screens (SET-002 to SET-011, all done) were built row by row from section 2.15 of the mock, and the storage rules were fixed in ADR 0138 (the catalogue lives in Python, generates its TypeScript twin and the browser resolves the layers). Nothing lists the whole schema in one place, so it is unclear which mock rows have a stored key, which live in another table, and which are still missing. SET-000 asks for that list with scopes and defaults.

## Options considered

1. Keep the catalogue as the only record and read it in code. Always current, but the planned rows and the places outside the catalogue stay invisible.
2. Write the schema once as an ADR, listing built keys, keys held elsewhere and planned keys, and let the catalogue stay the source for what is built.
3. Move every setting into the catalogue now, including notification kinds and task locks. One resolver, but it mixes data that has its own rules, such as mandatory notices and per-task reasons.

## Decision

Option 2. There are four scopes, as the mock's badges show them.

- Device settings stay on the computer in `parfocal.device-settings` and never reach the server.
- Personal settings follow the person in one workspace (`personal_settings`).
- Workspace settings are set by an admin in `workspace_settings` and may be locked, which the mock calls Set by your lab.
- Task locks belong to a review task, hold a reason of 5 to 120 characters and cover only the display settings that change what the AI shows (ADR 0132, display settings presets and task locks).

Resolution order is unchanged from ADR 0138. A locked workspace value wins, then personal, then device, then an unlocked workspace value, then the default. A task lock sits above all of these for its five lockable display fields: confidence, heatmap, score cutoff, other result sets and order.

### Built in the catalogue

| Key | Scope | Default | Mock row |
|---|---|---|---|
| theme | device | system | Theme |
| slide_brightness | device, 20 to 140 | 100 | Slide brightness |
| wheel_mode | device | zoom | Mouse wheel (zoom or pan) |
| invert_zoom | device | off | Invert zoom direction |
| camera_feel | device | smooth | Camera feel, no mock row |
| density | personal | comfortable | Density |
| length_unit | personal | auto | Lengths |
| language | personal | en | Language |
| magnification_label | personal | objective | Magnification label |
| tools | personal | rail | Tools (left rail or bottom dock) |
| side_panel_width | personal, 240 to 560 | 340 | Side panel width |
| hide_side_panel | personal | off | Hide the side panel |
| panel_while_moving | personal | pinned | Panel while moving |
| minimap | personal | useful | Minimap |
| slide_strip | personal | off | Pinned slide strip |
| confidence_wording | personal | words | Confidence wording |
| outline_mode | personal | fade | Outline mode |
| tier_outline | personal | best | Outline quality tier |
| inspector_track_record | personal | on | Inspector track record |
| inspector_calibration | personal | on | Inspector calibration |
| presets | personal, at most 3 names | none | Your presets |
| default_preset | personal, 0 to 3 | 0 | Default display preset |
| signature_block | personal | on | Signature block on reports |
| double_click | personal | zoom | Double-click |
| model_warnings | personal | on | Model warnings |
| home_layout | personal | role | Home layout (ADR 0191) |
| getting_started_hidden | personal | off | Getting started card |
| notify_ai_finished, notify_replies | personal | on | Notifications |
| slide_submitted_notice | personal | bell | A reviewer submits a slide of my task |
| initials_while_sharing | personal | on | Initials while sharing |
| analytics_opt_out | personal | off | Privacy |
| shortcut_preset | personal | default | Shortcuts preset |
| shortcut_custom | personal, at most 200 actions | none | Recorded keys |
| shortcut_single_letter, shortcut_by_position | personal | on | Shortcut switches |
| shortcut_whole_slide_key | personal | both | Whole slide key |
| patient_names | workspace or personal | full | Patient names, full or initials |
| decision_cutoff | workspace, 0 to 100 | 50 | Decision cutoff |
| analytics_policy | workspace | person | Analytics |
| lock_after_minutes | workspace, 1 to 240 | 15 | Lock after |
| two_factor_required | workspace | off | Security |
| patient_banner | workspace | on | Patient banner |
| default_privacy_mode | workspace | de-identified | Privacy mode |
| default_classes | workspace | none | Default classes |
| default_study_template | workspace | none | Default study template |
| tumor_share_cutoff and its two per-result switches | workspace | 20, off, on | Tumor share |
| unsure_zone_square_px, unsure_zone_min_nuclei, unsure_zone_min_unsure_percent, unsure_zone_min_unsure_cells | workspace | 128, 3, 30, 4 | Unsure zones |

Workspace settings that allow a personal value (only patient_names today) can also be locked, and then the person sees the workspace value with a lock.

### Held outside the catalogue, on purpose

| Data | Scope | Default | Where |
|---|---|---|---|
| Stat notice channel and sound | device | email, sound on | `notice_stat` and `stat_sound` in the device store |
| Developer mode | device | off | its own browser key |
| Notification preference per kind | personal | per kind, mandatory kinds cannot be turned off | the notifications preferences table and routes |
| Display values of a task and its locks | task | from the study template | `TaskDisplaySettings`, refused with `display-setting-locked` |
| Lab-only toggles of the lab bench | device | off | `lab-settings` in the browser |

### Planned, the mock has the row and no key exists

| Key | Scope | Default | Mock row |
|---|---|---|---|
| input_device | device | mouse | Main input device (mouse, trackpad, SpaceMouse, gamepad, pen) |
| wheel_mode gains `detect` | device | zoom | Mouse wheel, Detect device |
| pan_zoom_speed | device, 10 to 200 | 100 | Pan and zoom speed |
| spacemouse_rotation | device | off | SpaceMouse rotation |
| double_click value `toggle` meaning | personal | zoom | Last two magnifications |

Section 2.15 shows notifications as five rows (a task given, a mention, a slide submitted, a model run finished, a reminder) each with email, bell or quiet. The built screen uses the notification preference table for these, plus `slide_submitted_notice` and the two switches above. The planned work is to make the screen show all five rows, and the table already holds the kinds.

## Consequences

- A new setting still costs one line in `parfocal_api.settings_catalogue` and a regenerated TypeScript file. Anything not listed in the first table is a different kind of data and keeps its own store.
- The four planned device keys are small follow-ups to the Navigation and devices section (SET-006). They stay on the computer, so they need no migration and no API change.
- SET-012 (idea: home and worklist choice) would add `worklist_view` and `case_preview_on_select` as personal keys, with an experiment pin as a task lock. It stays an idea.
- The scope badges in the mock (device, you, lab) map to device, personal and workspace. A task lock has no badge row in the settings screen because it shows inside the Display panel.
