# 0191. The home layout is a personal setting set at setup and changed in settings

- Date: 2026-11-03
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: HOME-010 (role-based default home). Touches ONB-004 (first-run setup) and SET-002 (settings modal shell)

## Context

HOME-010 asks that a reviewer's home lead with the continue card and tasks and a researcher's with projects and Start something, set from the role chosen at setup and changeable in settings. Setup offers Researcher, Reviewer and Both, while a workspace membership holds only researcher or reviewer, and whoever creates a workspace becomes a researcher with admin rights whatever they picked ([ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md)). So the membership role cannot carry the setup choice.

## Options considered

1. A personal setting `home_layout` in the settings catalogue ([ADR 0138](0138-settings-catalogue-in-python-resolved-in-the-browser.md)), with `role`, `review`, `research` and `both`. Setup writes the picked role, settings change it, and no migration is needed.
2. A new column on the person or the membership for the setup role. It needs a migration and a route, and still needs a setting for the override.
3. Derive the layout from the membership role only. No storage, but Both and the override are lost, and a workspace creator who reviews gets the researcher home.

## Decision

Option 1. `home_layout` is a personal choice defaulting to `role`. Setup saves Researcher as `research`, Reviewer as `review` and Both as `both` when it finishes. With `role`, the home follows the membership role in the active workspace, a researcher getting `research` and anyone else `review`. Settings, Layout, Home offers From my role, Reviewing first, Projects first and Side by side, and From my role clears the stored value.

| Layout | Main column | Side column |
|---|---|---|
| `review` | Continue, Projects, Start something | Coming up, This week |
| `research` | Start something, Projects, Continue | This week, Coming up |
| `both` | Continue, Start something, Projects (the mock) | This week, Coming up |

## Consequences

- Personal settings live per person per workspace, so a person who joins a second workspace starts that one from their membership role until they choose.
- The fake API seeds `both` for the scenario, so the home stays identical to the frozen mock.
- SET-002 moves the settings modal onto the setting layers, and the Home row already writes through them.
