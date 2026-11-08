import type { SettingValues } from "@parfocal/api-client";

export type ShortcutSettings = {
  preset: SettingValues["shortcut_preset"];
  custom: Record<string, string[]>;
  single_letter: boolean;
  by_position: boolean;
  whole_slide_key: SettingValues["shortcut_whole_slide_key"];
};

export const shortcutsOfSettings = (values: SettingValues): ShortcutSettings => ({
  preset: values.shortcut_preset,
  custom: values.shortcut_custom,
  single_letter: values.shortcut_single_letter,
  by_position: values.shortcut_by_position,
  whole_slide_key: values.shortcut_whole_slide_key,
});

export const settingValuesOfShortcuts = (shortcuts: ShortcutSettings): Partial<SettingValues> => ({
  shortcut_preset: shortcuts.preset,
  shortcut_custom: shortcuts.custom,
  shortcut_single_letter: shortcuts.single_letter,
  shortcut_by_position: shortcuts.by_position,
  shortcut_whole_slide_key: shortcuts.whole_slide_key,
});
