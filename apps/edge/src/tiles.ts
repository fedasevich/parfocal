import { type Capability, overlapsRestricted, signingKey, verifyCapability } from "#capability.ts";

export type TileEnv = {
  readonly SLIDES: R2Bucket;
  readonly TILE_TOKEN_KEY: string;
};

export type Clock = () => number;

type Span = { readonly offset: number; readonly length?: number } | { readonly suffix: number };

const TILES_PREFIX = "/tiles/";
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;
const BASE_HEADERS = {
  "Cache-Control": "private, max-age=3600",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (key === undefined) {
    key = signingKey(secret);
    keys.set(secret, key);
  }
  return key;
}

export function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status, code },
    {
      status,
      headers: {
        ...BASE_HEADERS,
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
      },
    },
  );
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  const match = header === null ? null : /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  return match?.[1] ?? null;
}

function spanOf(header: string | null): Span | "invalid" | null {
  if (header === null) {
    return null;
  }
  const match = SINGLE_RANGE.exec(header.trim());
  if (match === null) {
    return "invalid";
  }
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") {
    return "invalid";
  }
  if (first === "") {
    const suffix = Number(last);
    return suffix > 0 ? { suffix } : "invalid";
  }
  const offset = Number(first);
  if (last === "") {
    return { offset };
  }
  const end = Number(last);
  return end >= offset ? { offset, length: end - offset + 1 } : "invalid";
}

function bounds(span: Span | null, size: number): readonly [number, number] | null {
  if (span === null) {
    return [0, size];
  }
  if ("suffix" in span) {
    return [Math.max(0, size - span.suffix), size];
  }
  if (span.offset >= size) {
    return null;
  }
  return [span.offset, Math.min(size, span.offset + (span.length ?? size))];
}

function slideKey(capability: Capability, name: string): string {
  return `t/${capability.tenant}/s/${capability.slide}/${name}`;
}

function objectHeaders(object: R2Object): Headers {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  return headers;
}

async function serve(request: Request, env: TileEnv, key: string, span: Span | null) {
  if (request.method === "HEAD") {
    const object = await env.SLIDES.head(key);
    if (object === null) {
      return problem(404, "not-found", "No such file");
    }
    const headers = objectHeaders(object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await env.SLIDES.get(key, span === null ? {} : { range: span });
  if (object === null) {
    return problem(404, "not-found", "No such file");
  }
  const headers = objectHeaders(object);
  if (span === null) {
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  const served = bounds(span, object.size);
  if (served === null) {
    headers.set("Content-Range", `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  const [start, end] = served;
  headers.set("Content-Range", `bytes ${start}-${end - 1}/${object.size}`);
  headers.set("Content-Length", String(end - start));
  return new Response(object.body, { status: 206, headers });
}

export async function handleTiles(request: Request, env: TileEnv, now: Clock): Promise<Response> {
  const url = new URL(request.url);
  const [slide = "", name = "", ...rest] = url.pathname.slice(TILES_PREFIX.length).split("/");
  if (rest.length > 0 || !FILE_NAME.test(name)) {
    return problem(404, "not-found", "No such file");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "method-not-allowed", "Tiles are read only");
  }
  const token = bearer(request);
  if (token === null) {
    return problem(401, "tile-token-missing", "A tile request needs a capability token");
  }
  const verdict = await verifyCapability(token, await keyFor(env.TILE_TOKEN_KEY), now());
  if (!verdict.ok) {
    return verdict.reason === "expired"
      ? problem(401, "tile-token-expired", "The capability token has expired")
      : problem(401, "tile-token-invalid", "The capability token is not valid");
  }
  const capability = verdict.capability;
  if (capability.slide !== slide) {
    return problem(403, "tile-token-other-slide", "The capability token is for another slide");
  }
  const span = spanOf(request.headers.get("Range"));
  if (span === "invalid") {
    return problem(416, "range-not-satisfiable", "Only one byte range is served per request");
  }
  const wanted =
    request.method === "GET" && name === capability.original ? bounds(span, capability.size) : null;
  if (wanted !== null && overlapsRestricted(capability.restricted, wanted[0], wanted[1])) {
    return problem(403, "range-restricted", "These bytes hold a label or macro image");
  }
  return serve(request, env, slideKey(capability, name), span);
}

export function isTilesPath(pathname: string): boolean {
  return pathname.startsWith(TILES_PREFIX);
}
