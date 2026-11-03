import { type Binding, parseKeys } from "./registry.ts";

export type Scope = "global" | "viewer" | "review" | "compare" | "annotate" | "worklist";

export type Preset = "default" | "qupath" | "figma";

export type ActionDef = {
  id: string;
  scope: Scope;
  keys: string[];
  presets?: Partial<Record<Exclude<Preset, "default">, string[]>>;
  hold?: boolean;
  sustain?: boolean;
  holdMs?: number;
  inInputs?: boolean;
};

export type Resolve = {
  preset?: Preset;
  personal?: Record<string, string[]>;
  scopes?: readonly Scope[];
  only?: readonly string[];
};

export const scopeRank: Record<Scope, number> = {
  global: 1,
  worklist: 2,
  viewer: 2,
  review: 3,
  compare: 3,
  annotate: 4,
};

const directionKeys: Record<string, [string, string, string, string]> = {
  Arrows: ["↑", "↓", "←", "→"],
  WASD: ["W", "S", "A", "D"],
  IJKL: ["I", "K", "J", "L"],
};

const directionNames = ["up", "down", "left", "right"];

export function expandSlot(slot: string): [suffix: string, keys: string[]][] {
  const direction = directionKeys[slot];
  if (direction)
    return direction.map(
      (key, index) => [`:${directionNames[index]}`, [key]] as [string, string[]],
    );
  const range = /^(.*?)(\d) … (.*?)(\d)$/.exec(slot);
  if (range) {
    const [, prefix = "", first = "0", , last = "0"] = range;
    const out: [string, string[]][] = [];
    for (let digit = Number(first); digit <= Number(last); digit++)
      out.push([`:${digit}`, parseKeys(`${prefix}${digit}`)]);
    return out;
  }
  return slot.trim() === "" ? [] : [["", parseKeys(slot)]];
}

export function slotsOf(def: ActionDef, { preset = "default", personal = {} }: Resolve): string[] {
  const named = preset === "default" ? undefined : def.presets?.[preset];
  return personal[def.id] ?? named ?? def.keys;
}

const overlap = (a: string[], b: string[]) => {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((key, index) => longer[index] === key);
};

type Ranked = { rank: number; binding: Binding };

export function createActionRegistry(defs: readonly ActionDef[]) {
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) throw new Error(`action ${def.id} is registered twice`);
    seen.add(def.id);
  }

  function bindings(options: Resolve = {}): Binding[] {
    const active = new Set<Scope>(["global", ...(options.scopes ?? [])]);
    const only = options.only === undefined ? null : new Set(options.only);
    const ranked: Ranked[] = [];
    for (const def of defs) {
      if (!active.has(def.scope) || (only !== null && !only.has(def.id))) continue;
      for (const slot of slotsOf(def, options))
        for (const [suffix, keys] of expandSlot(slot)) {
          const binding: Binding = { action: `${def.id}${suffix}`, keys };
          if (def.hold) binding.hold = true;
          if (def.sustain) binding.sustain = true;
          if (def.holdMs !== undefined) binding.holdMs = def.holdMs;
          if (def.inInputs) binding.inInputs = true;
          ranked.push({ rank: scopeRank[def.scope], binding });
        }
    }
    ranked.sort((a, b) => b.rank - a.rank);
    const kept: Ranked[] = [];
    for (const entry of ranked) {
      const shadowed = kept.some(
        (other) => other.rank > entry.rank && overlap(other.binding.keys, entry.binding.keys),
      );
      if (!shadowed) kept.push(entry);
    }
    return kept.map((entry) => entry.binding);
  }

  return { defs, bindings };
}

export function actionOf(fired: string): { id: string; suffix: string } {
  const at = fired.indexOf(":");
  return at < 0
    ? { id: fired, suffix: "" }
    : { id: fired.slice(0, at), suffix: fired.slice(at + 1) };
}
