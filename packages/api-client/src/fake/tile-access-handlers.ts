import { HttpResponse, http, passthrough, type RequestHandler } from "msw";
import type { TileAccess } from "../generated/api.ts";
import { sampleSlides, slides } from "./scenario.ts";

export const fakeTileLifetimeSeconds = 600;
export const fakeRemotePrefix = "remote-";
export const fakeOfflinePrefix = "remote-offline-";
export const fakeBrokenPrefix = "broken-";

const servedFile = (slideId: string): Pick<TileAccess, "original" | "format"> => {
  const converted = slides.find((slide) => slide.id === slideId)?.format;
  if (converted !== undefined) return { original: "original.tiff", format: converted };
  const sample = sampleSlides.some((item) => item.id === slideId);
  return { original: sample ? "original.tif" : "slide.tiff", format: "generic-tiff" };
};

export const toTileAccess = (slideId: string, now: Date = new Date()): TileAccess => {
  const remote = slideId.startsWith(fakeRemotePrefix);
  return {
    token: "fake-capability-token",
    expires_at: new Date(now.getTime() + fakeTileLifetimeSeconds * 1000).toISOString(),
    lifetime_seconds: fakeTileLifetimeSeconds,
    base_path: remote ? `/api/remote-tiles/${slideId}/` : `/tiles/${slideId}/`,
    ...servedFile(slideId),
    storage: remote ? "remote" : "uploaded",
    offline: slideId.startsWith(fakeOfflinePrefix),
  };
};

export const tileAccessHandlers = (): RequestHandler[] => [
  http.get<{ slideId: string }>("*/api/slides/:slideId/tile-access", ({ params }) =>
    params.slideId.startsWith(fakeBrokenPrefix)
      ? new HttpResponse(null, { status: 503 })
      : HttpResponse.json(toTileAccess(params.slideId), {
          headers: { "Cache-Control": "no-store" },
        }),
  ),
  http.get("*/api/remote-tiles/:slideId/:name", () => passthrough()),
];
