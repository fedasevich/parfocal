import type { ShortcutSettings } from "@parfocal/api-client";
import { keyActions, reservedKeys, shortcutPresetNames } from "./keymap.ts";

export const shortcutFileName = "shortcuts.json";

const fileKind = "parfocal-shortcuts";

const wholeSlideModes = ["both", "hold", "tap"] as const;

export type ShortcutImport =
  | { ok: true; settings: ShortcutSettings; dropped: string[] }
  | { ok: false; reason: string };

export function exportShortcuts(settings: ShortcutSettings): string {
  return `${JSON.stringify({ kind: fileKind, version: 1, ...settings }, null, 2)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keysDropped = (id: string, slots: string[]): string | null => {
  const action = keyActions.find((candidate) => candidate.id === id);
  if (action === undefined) return `${id} is not a shortcut here`;
  if (action.fixed) return `${action.name} stays fixed`;
  const bad = slots.find((slot) => reservedKeys[slot] !== undefined);
  if (bad !== undefined) return `${action.name}: the browser keeps ${bad}`;
  if (action.safe && slots.some((slot) => !/[⌘⌃]/.test(slot))) return `${action.name} needs ⌘ or ⌃`;
  return null;
};

export function importShortcuts(text: string, current: ShortcutSettings): ShortcutImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file is not JSON, so no shortcut changed" };
  }
  if (!isRecord(parsed) || parsed.kind !== fileKind)
    return { ok: false, reason: "That is not a Parfocal shortcuts file, so no shortcut changed" };
  if (parsed.version !== 1)
    return { ok: false, reason: "That file is from a newer version, so no shortcut changed" };
  const rawCustom = parsed.custom;
  if (!isRecord(rawCustom))
    return { ok: false, reason: "The file has no list of keys, so no shortcut changed" };
  const custom: Record<string, string[]> = {};
  const dropped: string[] = [];
  for (const [id, slots] of Object.entries(rawCustom)) {
    if (!Array.isArray(slots) || !slots.every((slot) => typeof slot === "string"))
      return { ok: false, reason: `The keys of ${id} are not a list, so no shortcut changed` };
    const reason = keysDropped(id, slots);
    if (reason === null) custom[id] = slots;
    else dropped.push(reason);
  }
  const preset =
    typeof parsed.preset === "string" && parsed.preset in shortcutPresetNames
      ? (parsed.preset as ShortcutSettings["preset"])
      : current.preset;
  const wholeSlide = wholeSlideModes.find((mode) => mode === parsed.whole_slide_key);
  return {
    ok: true,
    dropped,
    settings: {
      preset,
      custom,
      single_letter:
        typeof parsed.single_letter === "boolean" ? parsed.single_letter : current.single_letter,
      by_position:
        typeof parsed.by_position === "boolean" ? parsed.by_position : current.by_position,
      whole_slide_key: wholeSlide ?? current.whole_slide_key,
    },
  };
}
