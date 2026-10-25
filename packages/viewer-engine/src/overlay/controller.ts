import type { OverlayLayer, OverlayRegistration } from "../engine/types.ts";
import { withOverlayState } from "./overlay.ts";
import type { OverlayDescription } from "./types.ts";

export interface OverlayHost {
  registerOverlay(layer: OverlayLayer): OverlayRegistration;
}

export interface OverlayController {
  readonly set: (overlay: OverlayDescription) => void;
  readonly get: (id: string) => OverlayDescription | undefined;
  readonly list: () => readonly OverlayDescription[];
  readonly setVisible: (id: string, visible: boolean) => void;
  readonly setOpacity: (id: string, opacity: number) => void;
  readonly invalidate: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
}

interface Entry {
  readonly registration: OverlayRegistration;
  overlay: OverlayDescription;
}

export function createOverlayController(host: OverlayHost): OverlayController {
  const entries = new Map<string, Entry>();

  const entryFor = (id: string): Entry => {
    const entry = entries.get(id);
    if (entry === undefined) throw new Error(`Overlay ${id} is not in the controller`);
    return entry;
  };

  const replace = (entry: Entry, overlay: OverlayDescription) => {
    entry.overlay = overlay;
    entry.registration.update(overlay);
  };

  const set = (overlay: OverlayDescription) => {
    const entry = entries.get(overlay.id);
    if (entry === undefined) {
      entries.set(overlay.id, { registration: host.registerOverlay(overlay), overlay });
      return;
    }
    replace(entry, overlay);
  };

  const remove = (id: string) => {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    entry.registration.unregister();
  };

  return {
    set,
    get: (id) => entries.get(id)?.overlay,
    list: () => [...entries.values()].map((entry) => entry.overlay),
    setVisible: (id, visible) => {
      const entry = entryFor(id);
      replace(entry, withOverlayState(entry.overlay, { visible }));
    },
    setOpacity: (id, opacity) => {
      const entry = entryFor(id);
      replace(entry, withOverlayState(entry.overlay, { opacity }));
    },
    invalidate: (id) => {
      entryFor(id).registration.invalidate();
    },
    remove,
    clear: () => {
      for (const id of [...entries.keys()]) remove(id);
    },
  };
}
