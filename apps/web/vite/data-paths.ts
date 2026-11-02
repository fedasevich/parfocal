import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { Connect, Plugin } from "vite";

export const dataPathPrefixes = ["/tiles/", "/data/", "/models/"] as const;

const notFound = JSON.stringify({
  type: "https://parfocal.eu/problems/not-found",
  title: "No such file",
  status: 404,
  code: "not-found",
});

function decoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isFileIn(root: string, pathname: string): boolean {
  const relative = decoded(pathname);
  if (relative === null) return false;
  const file = normalize(join(root, relative));
  return file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile();
}

function missingDataIsNotFound(publicDir: () => string | false): Connect.NextHandleFunction {
  return (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://dev").pathname;
    if (!dataPathPrefixes.some((prefix) => pathname.startsWith(prefix))) return next();
    const root = publicDir();
    if (root !== false && isFileIn(root, pathname)) return next();
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/problem+json");
    response.setHeader("Cache-Control", "no-store");
    response.end(notFound);
  };
}

export function noAppPageForMissingData(): Plugin {
  let publicDir: string | false = false;
  return {
    name: "parfocal-no-app-page-for-missing-data",
    configResolved(config) {
      publicDir = config.publicDir === "" ? false : normalize(config.publicDir);
    },
    configureServer(server) {
      server.middlewares.use(missingDataIsNotFound(() => publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(missingDataIsNotFound(() => publicDir));
    },
  };
}
