import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { areaKey, markVisited } from "../screens/viewer/area-nav.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import type { SlideAreaEntry } from "./slide-areas.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const areaKeys = ["area", "prevarea", "nextarea"] as const;

type AreaModule = Pick<ViewerModule, "effectiveMagnification">;

export function useEngineAreaNav(
  engine: ViewerEngine,
  module: AreaModule,
  areas: readonly SlideAreaEntry[],
) {
  const [current, setCurrent] = useState<string | null>(null);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const order = useMemo(
    () =>
      [...areas]
        .sort((a, b) => b.size - a.size || a.object.localeCompare(b.object, "en"))
        .map((area) => area.object),
    [areas],
  );
  const latest = useRef({ current, order, areas });
  latest.current = { current, order, areas };

  const mark = useCallback(() => {
    const { current: object, order: ranked } = latest.current;
    if (object === null || engine.getMotion() !== "idle") return;
    const magnification = module.effectiveMagnification(
      engine.getCamera().zoom,
      engine.getSlide()?.micronsPerPixel ?? null,
    );
    if (magnification === null) return;
    setVisited((before) => markVisited(before, object, ranked, magnification));
  }, [engine, module]);

  useEffect(() => engine.subscribeCamera(mark), [engine, mark]);

  const goTo = useCallback(
    (object: string) => {
      const area = latest.current.areas.find((entry) => entry.object === object);
      if (area === undefined) return;
      setCurrent(object);
      latest.current.current = object;
      void engine.flyToArea(area.bounds).then((end) => {
        if (end === "arrived") mark();
      });
    },
    [engine, mark],
  );

  const bindings = useBindings(["viewer"], areaKeys);
  const onFire = useCallback(
    (fired: Fired) => {
      const key = areaKey(fired, latest.current.order, latest.current.current);
      if (key?.kind === "area") goTo(key.object);
    },
    [goTo],
  );
  useHotkeys(bindings, onFire);

  return { current, visited, goTo };
}
