import type { ShortcutSettings } from "@parfocal/api-client";
import { expandSlot, isSingleLetterKey, keysOverlap } from "../../keys/actions.ts";
import { keyNames, unshifted } from "../../keys/registry.ts";
import { type KeyAction, keyAction, keyActions, type PresetKey, reservedKeys } from "./keymap.ts";

export type ShortcutFilter = "all" | "changed" | "conflicts";

export type WholeSlide = "both" | "hold" | "tap";

export type Pending =
  | { kind: "conflict"; combo: string; other: string }
  | { kind: "reserved"; combo: string }
  | { kind: "safe"; combo: string }
  | { kind: "setclash"; combo: string; other: string; slot: string }
  | { kind: "dirclash"; value: string; names: string[] };

export type ShortcutState = {
  preset: PresetKey;
  custom: Record<string, string[]>;
  filter: ShortcutFilter;
  recording: { id: string; slot: number } | null;
  pending: Pending | null;
  finding: boolean;
  findKey: string | null;
  singleLetter: boolean;
  byPosition: boolean;
  wholeSlide: WholeSlide;
};

export type KeyPress = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type Outcome = { state: ShortcutState; message?: string };

export const freshShortcuts = (
  base: Partial<
    Pick<ShortcutState, "preset" | "custom" | "singleLetter" | "byPosition" | "wholeSlide">
  > = {},
): ShortcutState => ({
  preset: "default",
  custom: {},
  filter: "all",
  recording: null,
  pending: null,
  finding: false,
  findKey: null,
  singleLetter: true,
  byPosition: true,
  wholeSlide: "both",
  ...base,
});

export const currentKeys = (state: ShortcutState, action: KeyAction): string[] =>
  state.custom[action.id] ?? action.keys;

export const isChanged = (state: ShortcutState, action: KeyAction) =>
  state.custom[action.id] !== undefined;

const styleOf = (action: KeyAction) => /^in the style (.*)$/.exec(action.note ?? "")?.[1];

const sameContext = (a: KeyAction, b: KeyAction) => {
  if (a.context !== b.context) return false;
  const first = styleOf(a);
  const second = styleOf(b);
  return first === undefined || second === undefined || first === second;
};

const sequencesOf = (slots: string[]) =>
  slots.flatMap((slot) => expandSlot(slot).map(([, keys]) => keys));

export function clashingSlots(slot: string, others: string[]): string[] {
  const mine = sequencesOf([slot]);
  return others.filter((other) =>
    sequencesOf([other]).some((theirs) => mine.some((keys) => keysOverlap(keys, theirs))),
  );
}

export function conflicts(state: ShortcutState): [string, string, string, string][] {
  const found: [string, string, string, string][] = [];
  keyActions.forEach((a, index) => {
    for (const b of keyActions.slice(index + 1)) {
      if (!sameContext(a, b)) continue;
      const bKeys = currentKeys(state, b);
      for (const key of currentKeys(state, a)) {
        for (const theirs of clashingSlots(key, bKeys)) found.push([a.id, b.id, key, theirs]);
      }
    }
  });
  return found;
}

export const isSingleCharacter = (slot: string) =>
  isSingleLetterKey(expandSlot(slot)[0]?.[1][0] ?? "");

export function clashesWith(
  state: ShortcutState,
  action: KeyAction,
  slot: string,
): { other: KeyAction; slot: string }[] {
  return keyActions.flatMap((other) =>
    other.id === action.id || !sameContext(action, other)
      ? []
      : clashingSlots(slot, currentKeys(state, other)).map((theirs) => ({ other, slot: theirs })),
  );
}

const modifierKeys = ["Meta", "Control", "Alt", "Shift"];

export function comboOf(
  press: KeyPress,
  byPosition: boolean,
): { mods: string; key: string | null } {
  const mods =
    (press.ctrlKey && press.metaKey ? "⌃" : "") +
    (press.altKey ? "⌥" : "") +
    (press.shiftKey ? "⇧" : "") +
    (press.metaKey || press.ctrlKey ? "⌘" : "");
  if (modifierKeys.includes(press.key)) return { mods, key: null };
  const code = press.code ?? "";
  const key =
    keyNames[press.key] ??
    (byPosition && code.startsWith("Key")
      ? code.slice(3)
      : byPosition && code.startsWith("Digit")
        ? code.slice(5)
        : press.key.length === 1
          ? press.key.toUpperCase()
          : press.key);
  return { mods: unshifted(press.key) ? mods.replace("⇧", "") : mods, key };
}

export const foundBy = (keys: string[], findKey: string) =>
  keys.some((key) => key === findKey || key.startsWith(`${findKey} then`));

function assign(
  custom: Record<string, string[]>,
  id: string,
  slot: number,
  combo: string,
): Record<string, string[]> {
  const action = keyAction(id);
  const list = [...(custom[id] ?? action.keys)];
  list[slot] = combo;
  const clean = list.filter(Boolean);
  const next = { ...custom };
  if (clean.join("|") === action.keys.join("|")) delete next[id];
  else next[id] = clean;
  return next;
}

const done = (state: ShortcutState, custom = state.custom): ShortcutState => ({
  ...state,
  custom,
  recording: null,
  pending: null,
});

export const startRecording = (state: ShortcutState, id: string, slot: number): ShortcutState => ({
  ...state,
  recording: { id, slot },
  pending: null,
  finding: false,
});

export const cancelRecording = (state: ShortcutState): ShortcutState => done(state);

export function capture(state: ShortcutState, press: KeyPress): Outcome {
  const { mods, key } = comboOf(press, state.byPosition);
  if (state.finding) {
    if (!key) return { state };
    return { state: { ...state, finding: false, findKey: mods + key } };
  }
  const recording = state.recording;
  if (recording === null) return { state };
  const action = keyAction(recording.id);
  if (key === "Esc" && !mods) return { state: done(state) };
  if ((press.key === "Backspace" || press.key === "Delete") && !mods) {
    const list = [...currentKeys(state, action)];
    list.splice(recording.slot, 1);
    return { state: done(state, { ...state.custom, [action.id]: list }) };
  }
  if (action.range) {
    if (!mods || key) {
      return key
        ? {
            state,
            message: `Press only the modifier, for example ⌥ or ⌘. The numbers ${rangeDigits(action)} stay.`,
          }
        : { state };
    }
    const [first, last] = rangeDigits(action).split(" to ");
    return checkClash(state, action, `${mods}${first} … ${mods}${last}`, 0);
  }
  if (!key) return { state };
  const combo = action.sequence ? `${mods}${key} then 1 … 9` : mods + key;
  if (reservedKeys[mods + key]) {
    return { state: { ...state, pending: { kind: "reserved", combo: mods + key } } };
  }
  if (action.safe && !/[⌘⌃]/.test(mods)) {
    return { state: { ...state, pending: { kind: "safe", combo } } };
  }
  return checkClash(state, action, combo, recording.slot);
}

export function rangeDigits(action: KeyAction): string {
  const match = /(\d) … [^\d]*(\d)$/.exec(action.keys[0] ?? "");
  return `${match?.[1] ?? "1"} to ${match?.[2] ?? "6"}`;
}

function checkClash(state: ShortcutState, action: KeyAction, combo: string, slot: number): Outcome {
  const clashes = clashesWith(state, action, combo);
  const exact = clashes.find((clash) => clash.slot === combo);
  if (exact && !action.range && !action.sequence)
    return { state: { ...state, pending: { kind: "conflict", combo, other: exact.other.id } } };
  const first = clashes[0];
  if (first)
    return {
      state: {
        ...state,
        pending: { kind: "setclash", combo, other: first.other.id, slot: first.slot },
      },
    };
  return { state: done(state, assign(state.custom, action.id, slot, combo)) };
}

export function swap(state: ShortcutState): Outcome {
  const { recording, pending } = state;
  if (recording === null || pending?.kind !== "conflict") return { state };
  const action = keyAction(recording.id);
  const other = keyAction(pending.other);
  const old = currentKeys(state, action)[recording.slot];
  if (old === undefined) return { state };
  const otherSlot = currentKeys(state, other).indexOf(pending.combo);
  const custom = assign(
    assign(state.custom, other.id, otherSlot, old),
    action.id,
    recording.slot,
    pending.combo,
  );
  return {
    state: done(state, custom),
    message: `${action.name} is now ${pending.combo}, ${other.name.toLowerCase()} is ${old}`,
  };
}

export function take(state: ShortcutState): Outcome {
  const { recording, pending } = state;
  if (recording === null || pending?.kind !== "conflict") return { state };
  const action = keyAction(recording.id);
  const other = keyAction(pending.other);
  const custom = assign(
    {
      ...state.custom,
      [other.id]: currentKeys(state, other).filter((key) => key !== pending.combo),
    },
    action.id,
    recording.slot,
    pending.combo,
  );
  return {
    state: done(state, custom),
    message: `${other.name} has no key now. Give it one, or leave it to the menu and ⌘K`,
  };
}

export const safeCombo = (combo: string) => `⌘${combo.replace(/^[⇧⌥]+/, "")}`;

export function applySafeCombo(state: ShortcutState): ShortcutState {
  const { recording, pending } = state;
  if (recording === null || pending?.kind !== "safe") return state;
  return done(state, assign(state.custom, recording.id, recording.slot, safeCombo(pending.combo)));
}

export function pickDirection(state: ShortcutState, id: string, value: string): ShortcutState {
  const action = keyAction(id);
  const hit = clashesWith(state, action, value);
  if (hit.length > 0) {
    const names = hit.map((clash) => `${clash.other.name.toLowerCase()} (${clash.slot})`);
    return { ...state, pending: { kind: "dirclash", value, names } };
  }
  return done(state, assign(state.custom, id, 0, value));
}

export function resetKey(state: ShortcutState, id: string): ShortcutState {
  const custom = { ...state.custom };
  delete custom[id];
  return { ...state, custom };
}

const keyHit = (action: KeyAction, query: string) =>
  !query || "shortcuts keys".includes(query) || action.name.toLowerCase().includes(query);

export const anyKeyMatches = (query: string) => keyActions.some((action) => keyHit(action, query));

export function visibleActions(state: ShortcutState, query: string): KeyAction[] {
  const clashes = conflicts(state);
  return keyActions.filter(
    (action) =>
      keyHit(action, query) &&
      (state.filter === "changed"
        ? isChanged(state, action)
        : state.filter === "conflicts"
          ? clashes.some(([a, b]) => a === action.id || b === action.id)
          : true) &&
      (state.findKey === null || foundBy(currentKeys(state, action), state.findKey)),
  );
}

export type ShortcutScene =
  | "keys"
  | "changed"
  | "recording"
  | "conflict"
  | "reserved"
  | "safety"
  | "findkey";

export function sceneShortcuts(scene: ShortcutScene, base: ShortcutState): ShortcutState {
  const state = freshShortcuts({
    preset: base.preset,
    custom: base.custom,
    singleLetter: base.singleLetter,
    byPosition: base.byPosition,
    wholeSlide: base.wholeSlide,
  });
  switch (scene) {
    case "changed":
      return {
        ...state,
        custom: { truler: ["D"], dnext: ["J", "Space"], dagree: ["K", "A"] },
        filter: "changed",
      };
    case "recording":
      return { ...state, recording: { id: "truler", slot: 0 } };
    case "conflict":
      return {
        ...state,
        recording: { id: "truler", slot: 0 },
        pending: { kind: "conflict", combo: "M", other: "tmarker" },
      };
    case "reserved":
      return {
        ...state,
        recording: { id: "tcomment", slot: 0 },
        pending: { kind: "reserved", combo: "⌘W" },
      };
    case "safety":
      return {
        ...state,
        recording: { id: "signout", slot: 0 },
        pending: { kind: "safe", combo: "S" },
      };
    case "findkey":
      return { ...state, findKey: "L" };
    case "keys":
      return state;
  }
}

export const shortcutSettingsOf = (state: ShortcutState): ShortcutSettings => ({
  preset: state.preset,
  custom: state.custom,
  single_letter: state.singleLetter,
  by_position: state.byPosition,
  whole_slide_key: state.wholeSlide,
});

export const stateOfSettings = (settings: ShortcutSettings): ShortcutState =>
  freshShortcuts({
    preset: settings.preset,
    custom: settings.custom,
    singleLetter: settings.single_letter,
    byPosition: settings.by_position,
    wholeSlide: settings.whole_slide_key,
  });
