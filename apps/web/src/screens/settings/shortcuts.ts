import { type KeyAction, keyAction, keyActions, reservedKeys } from "./keymap.ts";

export type ShortcutFilter = "all" | "changed" | "conflicts";

export type WholeSlide = "both" | "hold" | "tap";

export type Pending =
  | { kind: "conflict"; combo: string; other: string }
  | { kind: "reserved"; combo: string }
  | { kind: "safe"; combo: string }
  | { kind: "dirclash"; value: string; names: string[] };

export type ShortcutState = {
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
  base: Partial<Pick<ShortcutState, "custom" | "singleLetter" | "byPosition" | "wholeSlide">> = {},
): ShortcutState => ({
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

const sameContext = (a: KeyAction, b: KeyAction) => a.context === b.context;

export function conflicts(state: ShortcutState): [string, string, string][] {
  const found: [string, string, string][] = [];
  keyActions.forEach((a, index) => {
    for (const b of keyActions.slice(index + 1)) {
      if (!sameContext(a, b)) continue;
      const bKeys = currentKeys(state, b);
      for (const key of currentKeys(state, a)) {
        if (bKeys.includes(key)) found.push([a.id, b.id, key]);
      }
    }
  });
  return found;
}

export const isSingleCharacter = (key: string) => /^[A-Z0-9=\-?]$/.test(key);

const namedKeys: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  " ": "Space",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
};

const modifierKeys = ["Meta", "Control", "Alt", "Shift"];

export function comboOf(
  press: KeyPress,
  byPosition: boolean,
): { mods: string; key: string | null } {
  const mods =
    (press.metaKey ? "⌘" : "") +
    (press.ctrlKey ? "⌃" : "") +
    (press.altKey ? "⌥" : "") +
    (press.shiftKey ? "⇧" : "");
  if (modifierKeys.includes(press.key)) return { mods, key: null };
  const code = press.code ?? "";
  const key =
    namedKeys[press.key] ??
    (byPosition && code.startsWith("Key")
      ? code.slice(3)
      : byPosition && code.startsWith("Digit")
        ? code.slice(5)
        : press.key.length === 1
          ? press.key.toUpperCase()
          : press.key);
  return { mods: press.key === "?" ? mods.replace("⇧", "") : mods, key };
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
  if ((key === "⌫" || key === "⌦") && !mods) {
    const list = [...currentKeys(state, action)];
    list.splice(recording.slot, 1);
    return { state: done(state, { ...state.custom, [action.id]: list }) };
  }
  if (action.range) {
    if (!mods || key) {
      return key
        ? {
            state,
            message: "Press only the modifier, for example ⌥ or ⌃. The numbers 1 to 6 stay.",
          }
        : { state };
    }
    return { state: done(state, assign(state.custom, action.id, 0, `${mods}1 … ${mods}6`)) };
  }
  if (!key) return { state };
  const combo = action.sequence ? `${mods}${key} then 1 … 9` : mods + key;
  if (reservedKeys[mods + key]) {
    return { state: { ...state, pending: { kind: "reserved", combo: mods + key } } };
  }
  if (action.safe && !/[⌘⌃]/.test(mods)) {
    return { state: { ...state, pending: { kind: "safe", combo } } };
  }
  const other = keyActions.find(
    (candidate) =>
      candidate.id !== action.id &&
      sameContext(action, candidate) &&
      currentKeys(state, candidate).includes(combo),
  );
  if (other) return { state: { ...state, pending: { kind: "conflict", combo, other: other.id } } };
  return { state: done(state, assign(state.custom, action.id, recording.slot, combo)) };
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
  const letters = value === "Arrows" ? [] : value.split("");
  const hit = keyActions.filter(
    (other) =>
      other.id !== action.id &&
      sameContext(action, other) &&
      currentKeys(state, other).some((key) => letters.includes(key)),
  );
  if (hit.length > 0) {
    const names = hit.map(
      (other) =>
        `${other.name.toLowerCase()} (${currentKeys(state, other).find((key) => letters.includes(key))})`,
    );
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
