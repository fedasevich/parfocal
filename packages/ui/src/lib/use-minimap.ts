import { useActorRef, useSelector } from "@xstate/react";
import { useMemo } from "react";
import { type MinimapSetting, shownMinimap } from "./minimap-box.ts";
import {
  type MinimapContext,
  type MinimapEvent,
  minimapMachine,
  peekIsOpen,
  sizeOfMode,
} from "./minimap-machine.ts";

export function useMinimap(setting: MinimapSetting, input?: Partial<MinimapContext>) {
  const actor = useActorRef(minimapMachine, { input });
  const value = useSelector(actor, (snapshot) => snapshot.value);
  const skips = useSelector(actor, (snapshot) => snapshot.context.skips);
  return useMemo(
    () => ({
      send: (event: MinimapEvent) => actor.send(event),
      mode: value.mode,
      size: shownMinimap(setting, sizeOfMode(value.mode)),
      faded: value.fade === "faded",
      peek: value.peek,
      peekOpen: peekIsOpen(value.peek),
      skips,
    }),
    [actor, value, setting, skips],
  );
}
