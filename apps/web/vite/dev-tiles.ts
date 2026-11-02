import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

const fixture = fileURLToPath(
  new URL("../../../packages/test-fixtures/synthetic/synthetic-jpeg.tiff", import.meta.url),
);

const levelTable = {
  levels: [
    { downsample: 1, width: 1024, height: 768, stored: { width: 1024, height: 768 } },
    { downsample: 2, width: 512, height: 384, stored: { width: 512, height: 384 } },
    { downsample: 4, width: 256, height: 192, stored: { width: 256, height: 192 } },
  ],
  scale: { mpp_x: 0.5, mpp_y: 0.5 },
};

export const slideFileName = "slide.tiff";
export const unavailablePrefix = "missing-";

const tilePath = /^\/tiles\/([^/]+)\/(levels\.json|slide\.tiff)$/;

function rangeOf(header: string | undefined, size: number): [number, number] | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (match === null || match === undefined) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  if (from === "") return [Math.max(0, size - Number(to)), size - 1];
  return [Number(from), to === "" ? size - 1 : Math.min(Number(to), size - 1)];
}

const fixtureTiles: Connect.NextHandleFunction = (request, response, next) => {
  const pathname = new URL(request.url ?? "/", "http://dev").pathname;
  const match = tilePath.exec(pathname);
  const slideId = match?.[1];
  const file = match?.[2];
  if (slideId === undefined || file === undefined || slideId.startsWith(unavailablePrefix)) {
    return next();
  }
  if (!existsSync(fixture)) return next();
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Accept-Ranges", "bytes");
  if (file === "levels.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(levelTable));
    return;
  }
  const size = statSync(fixture).size;
  const range = rangeOf(request.headers.range, size);
  response.setHeader("Content-Type", "image/tiff");
  if (range === null) {
    response.setHeader("Content-Length", size);
    createReadStream(fixture).pipe(response);
    return;
  }
  const [start, end] = range;
  response.statusCode = 206;
  response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  response.setHeader("Content-Length", end - start + 1);
  createReadStream(fixture, { start, end }).pipe(response);
};

export function fixtureTilesInDevOnly(): Plugin {
  return {
    name: "parfocal-fixture-tiles",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(fixtureTiles);
    },
  };
}
