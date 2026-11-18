import { createReadStream, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Connect, Plugin } from "vite";

const modelPath = /^\/models\/([a-z0-9][a-z0-9_-]{0,63}(?:\.[a-z0-9_-]{1,32}){0,3}\.onnx)$/;

export function localModelsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["PARFOCAL_MODELS_DIR"];
  if (configured) return join(configured, "onnx");
  const cache = env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  return join(cache, "parfocal", "models", "onnx");
}

function serveFrom(dir: () => string): Connect.NextHandleFunction {
  return (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://dev").pathname;
    const file = modelPath.exec(pathname)?.[1];
    if (file === undefined) return next();
    const path = join(dir(), file);
    if (!existsSync(path) || !statSync(path).isFile()) return next();
    const size = statSync(path).size;
    const etag = `"${size.toString(16)}-${Math.floor(statSync(path).mtimeMs).toString(16)}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "no-cache");
    if (request.headers["if-none-match"] === etag) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Length", size);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  };
}

export function localModels(dir: () => string = () => localModelsDir()): Plugin {
  return {
    name: "parfocal-local-models",
    configureServer(server) {
      server.middlewares.use(serveFrom(dir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveFrom(dir));
    },
  };
}
