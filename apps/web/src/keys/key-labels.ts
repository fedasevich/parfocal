import {
  type ActionDef,
  actionOf,
  expandSlot,
  isSingleLetterKey,
  type Resolve,
  slotsOf,
} from "./actions.ts";

const shown = (keys: string[]) => keys.join(" ");

const switchedOff = (resolve: Resolve, keys: string[] | undefined) =>
  resolve.singleLetter === false && isSingleLetterKey(keys?.[0] ?? "");

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
    if (switchedOff(resolve, only?.[1])) return null;
    return expanded.length === 1 && only !== undefined ? shown(only[1]) : first;
  }
  for (const slot of slots)
    for (const [part, keys] of expandSlot(slot))
      if (part === `:${suffix}`) return switchedOff(resolve, keys) ? null : shown(keys);
  return null;
}

export type ShortcutSettings = {
  preset: NonNullable<Resolve["preset"]>;
  custom: Record<string, string[]>;
  single_letter?: boolean;
  by_position?: boolean;
  whole_slide_key?: NonNullable<Resolve["wholeSlide"]>;
};

export const resolveOf = (settings: ShortcutSettings | undefined): Resolve =>
  settings === undefined
    ? {}
    : {
        preset: settings.preset,
        personal: settings.custom,
        ...(settings.single_letter === undefined ? {} : { singleLetter: settings.single_letter }),
        ...(settings.by_position === undefined ? {} : { byPosition: settings.by_position }),
        ...(settings.whole_slide_key === undefined ? {} : { wholeSlide: settings.whole_slide_key }),
      };

export function keyLabeller(defs: readonly ActionDef[], settings: ShortcutSettings | undefined) {
  const resolve = resolveOf(settings);
  return (fired: string) => keyLabel(defs, resolve, fired);
}
