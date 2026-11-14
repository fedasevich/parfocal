import type { EngineSlide, EngineStatus, RendererFactory } from "./types.ts";

export const RENDERER_ROUTE_IDS = ["viv", "deck-webgpu", "custom-webgpu"] as const;

export type RendererRouteId = (typeof RENDERER_ROUTE_IDS)[number];

export const PRIMARY_RENDERER_ROUTE: RendererRouteId = "viv";

export type RendererRouteLoader<Slide extends EngineSlide = EngineSlide> = () =>
  | RendererFactory<Slide>
  | Promise<RendererFactory<Slide>>;

export type RendererRouteLoaders<Slide extends EngineSlide = EngineSlide> = Partial<
  Record<RendererRouteId, RendererRouteLoader<Slide>>
>;

export type RendererSwitchOutcome = "switched" | "unchanged" | "superseded";

export class RendererRouteUnavailableError extends Error {
  readonly route: string;

  constructor(route: string) {
    super(`The ${route} renderer route is not registered`);
    this.name = "RendererRouteUnavailableError";
    this.route = route;
  }
}

export interface RendererSwitchTarget<Slide extends EngineSlide = EngineSlide> {
  readonly status: () => EngineStatus;
  readonly switchRenderer: (createRenderer: RendererFactory<Slide>) => void;
}

export interface RendererSwitcherOptions<Slide extends EngineSlide = EngineSlide> {
  readonly engine: RendererSwitchTarget<Slide>;
  readonly routes: RendererRouteLoaders<Slide>;
  readonly initial?: RendererRouteId;
}

export interface RendererSwitcher {
  readonly current: () => RendererRouteId;
  readonly available: () => readonly RendererRouteId[];
  readonly switchTo: (route: RendererRouteId) => Promise<RendererSwitchOutcome>;
}

export function availableRendererRoutes<Slide extends EngineSlide>(
  routes: RendererRouteLoaders<Slide>,
): readonly RendererRouteId[] {
  return RENDERER_ROUTE_IDS.filter((id) => routes[id] !== undefined);
}

export function createRendererSwitcher<Slide extends EngineSlide>(
  options: RendererSwitcherOptions<Slide>,
): RendererSwitcher {
  const { engine, routes } = options;
  let current = options.initial ?? PRIMARY_RENDERER_ROUTE;
  let generation = 0;

  const switchTo = async (route: RendererRouteId): Promise<RendererSwitchOutcome> => {
    const load = routes[route];
    if (load === undefined) throw new RendererRouteUnavailableError(route);
    generation += 1;
    const mine = generation;
    if (route === current) return "unchanged";
    const createRenderer = await load();
    if (mine !== generation || engine.status() === "disposed") return "superseded";
    engine.switchRenderer(createRenderer);
    current = route;
    return "switched";
  };

  return {
    current: () => current,
    available: () => availableRendererRoutes(routes),
    switchTo,
  };
}
