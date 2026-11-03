import { type ActionDef, actionOf, expandSlot, type Resolve, slotsOf } from "./actions.ts";

const shown = (keys: string[]) => keys.join(" ");

export function keyLabel(
  defs: readonly ActionDef[],
  resolve: Resolve,
  fired: string,
): string | null | undefined {
  const { id, suffix } = actionOf(fired);
  const def = defs.find((item) => item.id === id);
  if (def === undefined) return undefined;
  const slots = slotsOf(def, resolve);
  if (suffix === "") {
    const first = slots[0];
    if (first === undefined || first.trim() === "") return null;
    const expanded = expandSlot(first);
    const only = expanded[0];
    return expanded.length === 1 && only !== undefined ? shown(only[1]) : first;
  }
  for (const slot of slots)
    for (const [part, keys] of expandSlot(slot)) if (part === `:${suffix}`) return shown(keys);
  return null;
}

export type ShortcutSettings = {
  preset: NonNullable<Resolve["preset"]>;
  custom: Record<string, string[]>;
};

export const resolveOf = (settings: ShortcutSettings | undefined): Resolve =>
  settings === undefined ? {} : { preset: settings.preset, personal: settings.custom };

export function keyLabeller(defs: readonly ActionDef[], settings: ShortcutSettings | undefined) {
  const resolve = resolveOf(settings);
  return (fired: string) => keyLabel(defs, resolve, fired);
}
