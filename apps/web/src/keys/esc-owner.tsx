import { createContext, useContext, useEffect, useMemo } from "react";
import { escLayer } from "./esc-ladder.ts";
import { createEscRegistry, type EscRegistry } from "./esc-registry.ts";

const EscContext = createContext<EscRegistry | null>(null);

export const EscProvider = EscContext.Provider;

export const useEscRegistry = (): EscRegistry | null => useContext(EscContext);

export const useNewEscRegistry = (): EscRegistry => useMemo(createEscRegistry, []);

export function useEscOwner(registry: EscRegistry) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const layer = escLayer(registry.state());
      if (layer === null) return;
      registry.peel(layer);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);
}
