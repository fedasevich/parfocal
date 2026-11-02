export const tapMs = 350;
export const chordMs = 1000;

export type Binding = {
  action: string;
  keys: string[];
  hold?: boolean;
  inInputs?: boolean;
};

export type KeyInput =
  | {
      type: "down" | "up";
      key: string;
      code?: string;
      metaKey?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
      repeat?: boolean;
      typing?: boolean;
      at: number;
    }
  | { type: "blur"; at: number };

export type Phase = "press" | "hold-start" | "tap" | "hold-end";

export type Fired = { action: string; phase: Phase };

export type KeyState = {
  pending: { keys: string[]; at: number } | null;
  holding: { action: string; key: string; at: number } | null;
};

export type Step = { state: KeyState; fired: Fired[]; consumed: boolean };

export const idleKeys: KeyState = { pending: null, holding: null };

const modifierKeys = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn", "OS"]);

const namedKeys: Record<string, string> = {
  Enter: "↵",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
};

function baseKey(key: string, code: string | undefined): string {
  if (code?.startsWith("Digit")) return code.slice(5);
  if (code?.startsWith("Key")) return code.slice(3);
  if (namedKeys[key] !== undefined) return namedKeys[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

export function comboOf(input: Extract<KeyInput, { type: "down" | "up" }>): string {
  const mods = [
    input.ctrlKey && input.metaKey ? "⌃" : "",
    input.altKey ? "⌥" : "",
    input.shiftKey ? "⇧" : "",
    input.metaKey || input.ctrlKey ? "⌘" : "",
  ].join("");
  return mods + baseKey(input.key, input.code);
}

export function parseKeys(text: string): string[] {
  return text
    .split(/\s+then\s+/i)
    .map((part) => part.trim())
    .map((part) => (part.length === 1 ? part.toUpperCase() : part));
}

const startsWith = (keys: string[], prefix: string[]) =>
  prefix.length < keys.length && prefix.every((key, index) => keys[index] === key);

const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((key, index) => b[index] === key);

export function conflicts(bindings: readonly Binding[]): [string, string][] {
  const found: [string, string][] = [];
  bindings.forEach((one, index) => {
    for (const other of bindings.slice(index + 1)) {
      if (
        sameKeys(one.keys, other.keys) ||
        startsWith(one.keys, other.keys) ||
        startsWith(other.keys, one.keys)
      )
        found.push([one.action, other.action]);
    }
  });
  return found;
}

export function resolveBindings(
  defaults: readonly Binding[],
  ...layers: Record<string, string[]>[]
): Binding[] {
  return defaults.map((binding) => {
    const keys = layers.reduce<string[]>(
      (current, layer) => layer[binding.action] ?? current,
      binding.keys,
    );
    return { ...binding, keys };
  });
}

function startHolding(binding: Binding, key: string, at: number): Step {
  return {
    state: { pending: null, holding: { action: binding.action, key, at } },
    fired: [{ action: binding.action, phase: "hold-start" }],
    consumed: true,
  };
}

function press(
  bindings: readonly Binding[],
  state: KeyState,
  sequence: string[],
  key: string,
  at: number,
): Step | null {
  const exact = bindings.find((binding) => sameKeys(binding.keys, sequence));
  if (exact?.hold) return startHolding(exact, key, at);
  if (exact)
    return {
      state: { ...state, pending: null },
      fired: [{ action: exact.action, phase: "press" }],
      consumed: true,
    };
  if (bindings.some((binding) => startsWith(binding.keys, sequence)))
    return { state: { ...state, pending: { keys: sequence, at } }, fired: [], consumed: true };
  return null;
}

export function step(bindings: readonly Binding[], state: KeyState, input: KeyInput): Step {
  if (input.type === "blur") {
    const fired: Fired[] = state.holding
      ? [{ action: state.holding.action, phase: "hold-end" }]
      : [];
    return { state: idleKeys, fired, consumed: false };
  }
  if (modifierKeys.has(input.key)) return { state, fired: [], consumed: false };
  const combo = comboOf(input);
  const key = baseKey(input.key, input.code);

  if (input.type === "up") {
    const holding = state.holding;
    if (holding === null || baseKey(input.key, input.code) !== holding.key)
      return { state, fired: [], consumed: false };
    const phase: Phase = input.at - holding.at >= tapMs ? "hold-end" : "tap";
    return {
      state: { ...state, holding: null },
      fired: [{ action: holding.action, phase }],
      consumed: true,
    };
  }

  if (input.repeat && state.holding !== null) return { state, fired: [], consumed: true };
  const live = input.typing ? bindings.filter((binding) => binding.inInputs) : bindings;
  const fresh = state.pending !== null && input.at - state.pending.at <= chordMs;

  if (fresh && state.pending !== null) {
    if (combo === "Esc") return { state: { ...state, pending: null }, fired: [], consumed: true };
    const chained = press(live, state, [...state.pending.keys, combo], key, input.at);
    if (chained) return chained;
  }
  const cleared = { ...state, pending: null };
  if (input.repeat) {
    const single = live.find((binding) => !binding.hold && sameKeys(binding.keys, [combo]));
    return single
      ? { state: cleared, fired: [{ action: single.action, phase: "press" }], consumed: true }
      : { state: cleared, fired: [], consumed: false };
  }
  return (
    press(live, cleared, [combo], key, input.at) ?? { state: cleared, fired: [], consumed: false }
  );
}

export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  );
}
