import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type Capability,
  signCapability,
  signingKey,
  verifyCapability,
} from "@parfocal/edge/capability";
import type { Plugin } from "vite";

export const signedSlideId = "5a0f3c1e-8f6b-4d57-9a53-6d2f8e0c7b11";
export const signedTenantId = "c1b8f2d4-3a56-4e07-8b9c-1f2e3d4c5b6a";
export const tokenLifetimeSeconds = 600;

const SECRET = btoa("g".repeat(32));

export interface SignedRequestLog {
  readonly path: string;
  readonly status: number;
  readonly authorized: boolean;
  readonly range: string | null;
  readonly previousToken: boolean;
}

export interface SignedTileServer {
  readonly plugin: Plugin;
  readonly requests: SignedRequestLog[];
  readonly mints: () => number;
}

export interface SignedSlideFile {
  readonly original: string;
  readonly path: string;
  readonly levelTable: unknown;
}

function problem(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { "content-type": "application/problem+json" });
  response.end(JSON.stringify({ status, code }));
}

function bearer(request: IncomingMessage): string | null {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.authorization ?? "");
  return match?.[1] ?? null;
}

function sendRange(request: IncomingMessage, response: ServerResponse, path: string): number {
  const size = statSync(path).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (range === null) {
    response.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
    createReadStream(path).pipe(response);
    return 200;
  }
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
  if (start >= size) {
    response.writeHead(416, { "content-range": `bytes */${size}` });
    response.end();
    return 416;
  }
  response.writeHead(206, {
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`,
    "accept-ranges": "bytes",
  });
  createReadStream(path, { start, end }).pipe(response);
  return 206;
}

export function signedTileServer(
  file: SignedSlideFile,
  nowSeconds = () => Date.now() / 1000,
): SignedTileServer {
  const requests: SignedRequestLog[] = [];
  let minted = 0;
  const size = statSync(file.path).size;
  const key = signingKey(SECRET);

  const mint = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    minted++;
    const capability: Capability = {
      tenant: signedTenantId,
      slide: signedSlideId,
      original: file.original,
      size,
      restricted: [],
      expires: Math.floor(nowSeconds()) + tokenLifetimeSeconds,
    };
    const token = await signCapability(capability, await key);
    requests.push({
      path: "/api/tile-access",
      status: 200,
      authorized: true,
      range: null,
      previousToken: request.headers["previous-tile-token"] !== undefined,
    });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(
      JSON.stringify({
        token,
        expires_at: new Date(capability.expires * 1000).toISOString(),
        lifetime_seconds: tokenLifetimeSeconds,
        base_path: `/tiles/${signedSlideId}/`,
        original: file.original,
      }),
    );
  };

  const tile = async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    const [slide = "", name = ""] = pathname.slice("/tiles/".length).split("/");
    const log = (status: number, authorized: boolean) => {
      requests.push({
        path: pathname,
        status,
        authorized,
        range: request.headers.range ?? null,
        previousToken: false,
      });
    };
    const token = bearer(request);
    if (token === null) {
      log(401, false);
      return problem(response, 401, "tile-token-missing");
    }
    const verdict = await verifyCapability(token, await key, nowSeconds());
    if (!verdict.ok) {
      log(401, false);
      return problem(response, 401, "tile-token-invalid");
    }
    if (verdict.capability.slide !== slide) {
      log(403, false);
      return problem(response, 403, "tile-token-other-slide");
    }
    if (name === "levels.json") {
      log(200, true);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(file.levelTable));
      return;
    }
    if (name !== verdict.capability.original) {
      log(404, true);
      return problem(response, 404, "not-found");
    }
    log(sendRange(request, response, file.path), true);
  };

  const plugin: Plugin = {
    name: "parfocal-signed-tiles",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://x").pathname;
        if (pathname === `/api/slides/${signedSlideId}/tile-access`) {
          void mint(request, response);
          return;
        }
        if (pathname.startsWith("/tiles/")) {
          void tile(request, response, pathname);
          return;
        }
        next();
      });
    },
  };

  return { plugin, requests, mints: () => minted };
}
