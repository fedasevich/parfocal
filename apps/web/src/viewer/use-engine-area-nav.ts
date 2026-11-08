import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { areaKey, markVisited } from "../screens/viewer/area-nav.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { createTravel } from "./travel.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const areaKeys = ["area", "prevarea", "nextarea"] as const;

type AreaModule = Pick<ViewerModule, "effectiveMagnification">;

export function useEngineAreaNav(
  engine: ViewerEngine,
  module: AreaModule,
  areas: readonly SlideAreaEntry[],
  host: HTMLElement | null = null,
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

  const hostRef = useRef(host);
  hostRef.current = host;
  const travel = useMemo(
    () =>
      createTravel(engine, {
        viewport: () => {
          const box = hostRef.current?.getBoundingClientRect();
          return { width: box?.width ?? 0, height: box?.height ?? 0 };
        },
        onArrive: () => mark(),
      }),
    [engine, mark],
  );
  const travelling = useSyncExternalStore(travel.subscribe, travel.get);

  useEffect(() => {
    if (travelling === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (travel.press(event) === "skip") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [travel, travelling]);

  const goTo = useCallback(
    (object: string) => {
      const area = latest.current.areas.find((entry) => entry.object === object);
      if (area === undefined) return;
      setCurrent(object);
      latest.current.current = object;
      void travel.start(object, area.bounds);
    },
    [travel],
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

  return { current, visited, goTo, travelling };
}
