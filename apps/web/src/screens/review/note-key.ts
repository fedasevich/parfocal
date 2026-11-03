import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";

export const noteAction = "dnote";

const noteActions = [noteAction];

export function useNoteKey(onNote: () => void) {
  const bindings = useBindings(["review"], noteActions);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase === "press") onNote();
  });
}
