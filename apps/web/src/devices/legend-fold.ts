import { useCallback, useSyncExternalStore } from "react";

export type LegendFold = "open" | "collapsed" | "hidden";

export const legendFoldKey = "parfocal.device-legend-fold";

const listeners = new Set<() => void>();

function read(): LegendFold {
  try {
    const stored = window.localStorage.getItem(legendFoldKey);
    return stored === "collapsed" || stored === "hidden" ? stored : "open";
  } catch {
    return "open";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useLegendFold(): [LegendFold, (next: LegendFold) => void] {
  const fold = useSyncExternalStore(subscribe, read, () => "open" as const);
  const change = useCallback((next: LegendFold) => {
    try {
      window.localStorage.setItem(legendFoldKey, next);
    } catch {
      return;
    }
    for (const listener of listeners) listener();
  }, []);
  return [fold, change];
}
