import { createReadStream, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

const fixture = fileURLToPath(
  new URL("../../../packages/test-fixtures/synthetic/synthetic-jpeg.tiff", import.meta.url),
);

const levelTable = {
  levels: [
    { downsample: 1, width: 1024, height: 768, page: 0, ifdOffset: 8, ifdBytes: 246 },
    { downsample: 2, width: 512, height: 384, page: 1, ifdOffset: 55_848, ifdBytes: 234 },
    { downsample: 4, width: 256, height: 192, page: 2, ifdOffset: 79_190, ifdBytes: 234 },
  ].map((level) => ({
    ...level,
    stored: { width: level.width, height: level.height },
    subIfd: null,
    siblings: [],
  })),
  scale: { mpp_x: 0.5, mpp_y: 0.5 },
};

export const slideFileName = "slide.tiff";

export const devSlideFolders =
  process.env["PARFOCAL_DEV_SLIDE_FOLDERS"] ??
  join(process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "parfocal", "dev-slides");

const folderFile = /^\/(?:tiles|api\/remote-tiles)\/([A-Za-z0-9-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

const contentTypes: Record<string, string> = {
  json: "application/json",
  jpg: "image/jpeg",
};

function devSlideFile(pathname: string): string | null {
  const match = folderFile.exec(pathname);
  if (match === null) return null;
  const [, slideId = "", name = ""] = match;
  const file = join(devSlideFolders, slideId, name);
  return existsSync(file) && statSync(file).isFile() ? file : null;
}
export const unavailablePrefix = "missing-";

const tilePath =
  /^\/(?:tiles|api\/remote-tiles)\/([^/]+)\/(levels\.json|[^/]+\.(?:tiff?|svs|ndpi|scn|mrxs|bif|vsi|dcm))$/;

function rangeOf(header: string | undefined, size: number): [number, number] | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (match === null || match === undefined) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  if (from === "") return [Math.max(0, size - Number(to)), size - 1];
  return [Number(from), to === "" ? size - 1 : Math.min(Number(to), size - 1)];
}

function sendFile(
  file: string,
  request: Connect.IncomingMessage,
  response: Parameters<Connect.NextHandleFunction>[1],
): void {
  const size = statSync(file).size;
  const range = rangeOf(request.headers.range, size);
  const extension = file.slice(file.lastIndexOf(".") + 1);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", contentTypes[extension] ?? "image/tiff");
  if (range === null) {
    response.setHeader("Content-Length", size);
    createReadStream(file).pipe(response);
    return;
  }
  const [start, end] = range;
  response.statusCode = 206;
  response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  response.setHeader("Content-Length", end - start + 1);
  createReadStream(file, { start, end }).pipe(response);
}

const fixtureTiles: Connect.NextHandleFunction = (request, response, next) => {
  const pathname = new URL(request.url ?? "/", "http://dev").pathname;
  const own = devSlideFile(pathname);
  if (own !== null) {
    sendFile(own, request, response);
    return;
  }
  const match = tilePath.exec(pathname);
  const slideId = match?.[1];
  const file = match?.[2];
  if (slideId === undefined || file === undefined || slideId.startsWith(unavailablePrefix)) {
    return next();
  }
  if (!existsSync(fixture)) return next();
  if (file === "levels.json") {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(levelTable));
    return;
  }
  sendFile(fixture, request, response);
};

export function fixtureTilesWithDevTools(devTools: boolean): Plugin {
  return {
    name: "parfocal-fixture-tiles",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(fixtureTiles);
    },
    configurePreviewServer(server) {
      if (devTools) server.middlewares.use(fixtureTiles);
    },
  };
}
