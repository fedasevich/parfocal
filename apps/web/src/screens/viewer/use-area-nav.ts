import { createViewHistory, viewHistoryLimit, viewRestMs } from "@parfocal/viewer-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keyRegistry } from "../../keys/catalogue.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { areaKey, areaKeyIds, markVisited, type Spot, sameSpot } from "./area-nav.ts";

type AreaNavOptions = {
  order: readonly string[];
  spot: Spot;
  magnification: number;
  goTo: (object: string) => void;
  restore: (spot: Spot) => void;
  intercept?: (fired: Fired) => boolean;
};

export function useAreaNav({ order, spot, magnification, ...handlers }: AreaNavOptions) {
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const history = useMemo(() => createViewHistory<Spot>(viewHistoryLimit, sameSpot), []);
  const latest = useRef({ order, spot, ...handlers });
  latest.current = { order, spot, ...handlers };

  useEffect(() => {
    setVisited((before) => markVisited(before, spot.object, order, magnification));
  }, [spot.object, order, magnification]);

  const { object, x, y, z } = spot;
  useEffect(() => {
    const timer = setTimeout(() => history.settle({ object, x, y, z }), viewRestMs);
    return () => clearTimeout(timer);
  }, [history, object, x, y, z]);

  const goTo = useCallback(
    (target: string) => {
      const now = latest.current;
      if (target === now.spot.object) return;
      history.settle(now.spot);
      now.goTo(target);
    },
    [history],
  );

  const bindings = useMemo(
    () => keyRegistry.bindings({ scopes: ["viewer"], only: areaKeyIds }),
    [],
  );
  const onFire = useCallback(
    (fired: Fired) => {
      const now = latest.current;
      if (now.intercept?.(fired)) return;
      const key = areaKey(fired, now.order, now.spot.object);
      if (key === null) return;
      if (key.kind === "area") {
        goTo(key.object);
        return;
      }
      const view = key.kind === "back" ? history.back(now.spot) : history.forward(now.spot);
      if (view !== null) now.restore(view);
    },
    [history, goTo],
  );
  useHotkeys(bindings, onFire);

  return { visited, goTo };
}
