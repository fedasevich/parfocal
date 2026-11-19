export const settingsSectionKeys = [
  "display",
  "review",
  "layout",
  "ai",
  "navigation",
  "shortcuts",
  "notifications",
  "privacy",
  "account",
] as const;

export type SettingsSection = (typeof settingsSectionKeys)[number];
