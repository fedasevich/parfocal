import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { inLayer } from "./answer-keys.ts";

export const nextObjectAction = "dnext";
export const previousObjectAction = "dprev";

const objectActions = [nextObjectAction, previousObjectAction];

export function useObjectKeys(onNext: () => void, onPrevious: () => void, enabled = true) {
  const bindings = useBindings(["review"], objectActions, enabled);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase !== "press" || inLayer()) return;
    if (fired.action === nextObjectAction) onNext();
    else if (fired.action === previousObjectAction) onPrevious();
  });
}
