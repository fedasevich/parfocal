import { useCallback } from "react";
import { keyRegistry } from "../keys/catalogue.ts";
import { useBindings } from "../keys/personal-keys.ts";
import type { Binding, Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { classKeyAction, slotOfAction } from "./classes.ts";

export function classKeyBindings(): Binding[] {
  return keyRegistry.bindings({ scopes: ["annotate"], only: [classKeyAction] });
}

export function slotOfFired(fired: Fired): number | null {
  return fired.phase === "press" ? slotOfAction(fired.action) : null;
}

const classKeyActions = [classKeyAction];

export function useClassKeys(onSlot: (slot: number) => void, enabled = true) {
  const bindings = useBindings(["annotate"], classKeyActions, enabled);
  const onFire = useCallback(
    (fired: Fired) => {
      const slot = slotOfFired(fired);
      if (slot !== null) onSlot(slot);
    },
    [onSlot],
  );
  useHotkeys(bindings, onFire);
}
