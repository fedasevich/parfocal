import { useMemo } from "react";
import { keyRegistry } from "../../keys/catalogue.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";

export const noteAction = "dnote";

export function useNoteKey(onNote: () => void) {
  const bindings = useMemo(
    () => keyRegistry.bindings({ scopes: ["review"], only: [noteAction] }),
    [],
  );
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase === "press") onNote();
  });
}
