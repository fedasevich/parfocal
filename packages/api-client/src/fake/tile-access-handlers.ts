import { HttpResponse, http, type RequestHandler } from "msw";
import type { TileAccess } from "../generated/api.ts";
import { sampleSlides } from "./scenario.ts";

export const fakeTileLifetimeSeconds = 600;

export const toTileAccess = (slideId: string, now: Date = new Date()): TileAccess => ({
  token: "fake-capability-token",
  expires_at: new Date(now.getTime() + fakeTileLifetimeSeconds * 1000).toISOString(),
  lifetime_seconds: fakeTileLifetimeSeconds,
  base_path: `/tiles/${slideId}/`,
  original: sampleSlides.some((sample) => sample.id === slideId) ? "original.tif" : "slide.tiff",
  format: "generic-tiff",
});

export const tileAccessHandlers = (): RequestHandler[] => [
  http.get<{ slideId: string }>("*/api/slides/:slideId/tile-access", ({ params }) =>
    HttpResponse.json(toTileAccess(params.slideId), { headers: { "Cache-Control": "no-store" } }),
  ),
];
