# 0138. The settings catalogue lives in Python, generates its TypeScript twin, and the browser resolves the layers

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: SET-001 (settings storage and resolution). Touches SET-002 to SET-011 (the settings sections and the workspace console)

## Context

SET-001 asks for personal and lab settings stored on the server, device settings stored on the computer, the order lab locked, then personal, then device, then default, and one typed schema shared by client and server. The mock keeps device settings such as theme, brightness and the wheel with the computer, personal ones with the person on any workstation, and shows lab ones locked. The server must refuse a bad value, and only the browser knows the device layer.

## Options considered

1. The catalogue in Python, with a generated TypeScript file of the keys, types, defaults and allowed layers, the server validating writes, and the browser resolving. One source, the server stays the gate, and a currency test catches a stale TypeScript file.
2. The catalogue in TypeScript, with the server reading a JSON copy. The client owns the shape, but the server, which validates, would read a file another language writes.
3. One OpenAPI model with every key as a field. The client types come from the existing generator, but defaults and allowed layers are not part of a schema, so the resolver would still need a second source.

## Decision

Option 1. `parfocal_api.settings_catalogue` lists every setting with its kind, default, options or bounds and the layers that may hold it. `python -m parfocal_api.settings_catalogue` writes `packages/api-client/src/settings/catalogue.generated.ts`, and `test_settings.py` fails when it is stale.

| Concern | Rule |
|---|---|
| Storage | `personal_settings` (one JSON row per person in a workspace) and `workspace_settings` (one JSON row and a list of locked keys per workspace), both under row-level security |
| Routes | `GET /api/me/setting-layers` (`getMySettingLayers`) returns the workspace layer with its locks and the caller's personal layer. `PUT /api/me/setting-layers` (`setMySettingLayers`) merges personal values, a `null` clears one. `PUT /api/tenant/settings` sets workspace values and locks, under `workspace-settings`, audited as `tenant.settings-changed` |
| Checks | A key the layer may not hold or an unknown key is 400 `unknown-setting`, a value outside its kind is 400 `invalid-setting`, a personal value for a locked key is 409 `setting-locked`, and a lock needs a workspace value |
| Resolution | `resolveSetting` in the API client: a locked workspace value, then personal, then device, then an unlocked workspace value, then the default. A value in a layer the key does not allow, or one that no longer fits, is skipped. Each result names its source for the scope badges |

An unlocked workspace value sits just above the default, so a lab can set its own default that people still change. The task text names no place for it, and SET-011 (workspace settings console) needs one.

## Consequences

- SET-002 to SET-010 read `resolveSettings` and write personal values through `setMySettingLayers`, and keep device values in the browser's storage under their keys. The settings prototype still reads the draft `getMySettings`, whose shape adds shortcuts and presets, and SET-002 (settings modal shell) moves it onto these routes and deletes the draft.
- SET-011 (workspace settings console) is the screen over `setWorkspaceSettings`.
- Adding a setting is one line in the catalogue, then the generator.
- `personal_settings.values` is personal data, so the person's export includes it through the data map.
