import { mapInput } from "../../devices/intents.ts";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { inLayer } from "./answer-keys.ts";

export const nextObjectAction = "dnext";
export const previousObjectAction = "dprev";

const objectActions = [nextObjectAction, previousObjectAction];

const stepKeys: Record<string, { key: string; shift: boolean }> = {
  [nextObjectAction]: { key: "j", shift: false },
  [previousObjectAction]: { key: "j", shift: true },
};

export function objectStepOf(action: string): 1 | -1 | null {
  const raw = stepKeys[action];
  if (!raw) return null;
  const [intent] = mapInput("keyboard", "review", { kind: "key", ...raw });
  if (intent?.kind === "nextCell") return 1;
  if (intent?.kind === "previousCell") return -1;
  return null;
}

export function useObjectKeys(onNext: () => void, onPrevious: () => void, enabled = true) {
  const bindings = useBindings(["review"], objectActions, enabled);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase !== "press" || inLayer()) return;
    const step = objectStepOf(fired.action);
    if (step === 1) onNext();
    else if (step === -1) onPrevious();
  });
}
