export const packageName = "@parfocal/api-client";

export type { DecisionStyle } from "./draft/index.ts";
export * from "./draft/index.ts";
export { type ApiResponse, apiFetch } from "./fetcher.ts";
export * from "./generated/api.ts";
export {
  ApiError,
  type ErrorKind,
  type FieldError,
  isProblem,
  kindForStatus,
  networkError,
  type Problem,
  problemMediaType,
  toApiError,
} from "./problem.ts";
export {
  catalogue as settingsCatalogue,
  type Layer as SettingLayer,
  type SettingEntry,
  type SettingKey,
  type SettingValues,
} from "./settings/catalogue.generated.ts";
export {
  type Resolved as ResolvedSetting,
  resolveSetting,
  resolveSettings,
  type SettingLayers,
  type Source as SettingSource,
  type StoredValues as StoredSettingValues,
} from "./settings/resolve.ts";
