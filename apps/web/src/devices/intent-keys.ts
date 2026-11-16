import {
  magnificationPresets,
  nearestMagnificationPreset,
} from "@parfocal/ui/lib/magnification-bar";
import type { Intent } from "./intents.ts";

export type IntentKey = { key: string; code: string; shiftKey: boolean };

const letter = (key: string, shiftKey = false): IntentKey => ({
  key,
  code: `Key${key.toUpperCase()}`,
  shiftKey,
});

const fixedKeys: Partial<Record<Intent["kind"], IntentKey>> = {
  keep: letter("k"),
  notACell: letter("x"),
  nextCell: letter("j"),
  previousCell: letter("j", true),
  nextArea: { key: "]", code: "BracketRight", shiftKey: false },
  previousArea: { key: "[", code: "BracketLeft", shiftKey: false },
};

export function keyForIntent(intent: Intent): IntentKey | null {
  if (intent.kind === "setType") {
    return { key: String(intent.type), code: `Digit${intent.type}`, shiftKey: false };
  }
  return fixedKeys[intent.kind] ?? null;
}

type KeyEventInit = IntentKey & { bubbles: boolean };

export function dispatchIntentKey(
  intent: Intent,
  target: Pick<Window, "dispatchEvent">,
  make: (type: "keydown" | "keyup", init: KeyEventInit) => Event = (type, init) =>
    new KeyboardEvent(type, init),
): boolean {
  const spec = keyForIntent(intent);
  if (spec === null) return false;
  const init = { ...spec, bubbles: true };
  target.dispatchEvent(make("keydown", init));
  target.dispatchEvent(make("keyup", init));
  return true;
}

export function steppedPreset(magnification: number, step: 1 | -1): number {
  const current = nearestMagnificationPreset(magnification);
  const index = magnificationPresets.indexOf(current) + step;
  const last = magnificationPresets.length - 1;
  return magnificationPresets[Math.min(last, Math.max(0, index))] ?? current;
}
