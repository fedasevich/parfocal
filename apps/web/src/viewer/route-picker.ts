import type { LabSettings } from "../lab/lab-settings.ts";

export type EngineRouteId = "viv" | "deck-webgpu" | "custom-webgpu";

export const engineRouteOf: Record<LabSettings["renderer"], EngineRouteId> = {
  viv: "viv",
  deck: "deck-webgpu",
  webgpu: "custom-webgpu",
};

export interface RouteSwitchable {
  readonly shownRoute: () => EngineRouteId;
  readonly availableRoutes: () => readonly EngineRouteId[];
  readonly switchRoute: (id: EngineRouteId) => Promise<unknown>;
}

export interface RoutePickerSource {
  readonly wanted: () => EngineRouteId;
  readonly subscribe: (notify: () => void) => () => void;
}

export interface RoutePickerOptions {
  readonly viewport: RouteSwitchable;
  readonly source: RoutePickerSource;
  readonly onShown: (shown: EngineRouteId, refused: Error | null) => void;
}

export interface RoutePicker {
  readonly settled: Promise<void>;
  readonly fallBack: (reason: Error) => Promise<void>;
  readonly dispose: () => void;
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export function pickRoutes(options: RoutePickerOptions): RoutePicker {
  const { viewport, source, onShown } = options;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  const show = async (target: EngineRouteId): Promise<void> => {
    if (disposed) return;
    const before = viewport.shownRoute();
    let refused: Error | null = null;
    if (target !== before) {
      try {
        await viewport.switchRoute(target);
      } catch (error) {
        refused = asError(error);
      }
    }
    if (disposed) return;
    if (viewport.shownRoute() !== before || refused !== null)
      onShown(viewport.shownRoute(), refused);
  };

  const enqueue = (run: () => Promise<void>): Promise<void> => {
    queue = queue.then(run, run);
    return queue;
  };

  let lastWanted: EngineRouteId | null = null;

  const follow = () =>
    enqueue(async () => {
      const wanted = source.wanted();
      if (wanted === lastWanted) return;
      lastWanted = wanted;
      const target = viewport.availableRoutes().includes(wanted) ? wanted : "viv";
      return show(target);
    });

  const settled = follow();
  const unsubscribe = source.subscribe(() => {
    void follow();
  });

  return {
    settled,
    fallBack: (reason) =>
      enqueue(async () => {
        if (disposed || viewport.shownRoute() === "viv") return;
        await viewport.switchRoute("viv").catch(() => undefined);
        if (!disposed) onShown(viewport.shownRoute(), reason);
      }),
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
}
