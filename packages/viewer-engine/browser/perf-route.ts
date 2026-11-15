import { WEBGPU_SWIFTSHADER_ARGS } from "../../golden-images/src/playwright.ts";
import { PRIMARY_RENDERER_ROUTE, RENDERER_ROUTE_IDS, type RendererRouteId } from "../src/index.ts";

function routeFromEnvironment(): RendererRouteId {
  const named = process.env.PARFOCAL_RENDERER_ROUTE;
  if (named === undefined || named === "") return PRIMARY_RENDERER_ROUTE;
  const route = RENDERER_ROUTE_IDS.find((id) => id === named);
  if (route === undefined) {
    throw new Error(
      `PARFOCAL_RENDERER_ROUTE is ${named}, expected one of ${RENDERER_ROUTE_IDS.join(", ")}`,
    );
  }
  return route;
}

export const perfRoute: RendererRouteId = routeFromEnvironment();

export const perfRouteLaunchOptions =
  perfRoute === PRIMARY_RENDERER_ROUTE
    ? null
    : { args: [...WEBGPU_SWIFTSHADER_ARGS, "--enable-blink-features=ForceEagerMeasureMemory"] };
