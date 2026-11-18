import { problem, type TileEnv } from "#tiles.ts";

export const MODELS_PATH = "/models/";
export const MODELS_KEY_PREFIX = "models/";
export const MODEL_CACHE_CONTROL = "public, max-age=86400";

const MODEL_FILE = /^[a-z0-9][a-z0-9_-]{0,63}(\.[a-z0-9_-]{1,32}){0,3}\.onnx$/;

export function isModelsPath(pathname: string): boolean {
  return pathname.startsWith(MODELS_PATH);
}

export function modelKey(pathname: string): string | null {
  const file = pathname.slice(MODELS_PATH.length);
  return MODEL_FILE.test(file) ? `${MODELS_KEY_PREFIX}${file}` : null;
}

function modelHeaders(object: R2Object): Headers {
  return new Headers({
    "Cache-Control": MODEL_CACHE_CONTROL,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(object.size),
    ETag: object.httpEtag,
    "X-Content-Type-Options": "nosniff",
  });
}

function hasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return "body" in object;
}

export async function handleModels(request: Request, env: Pick<TileEnv, "SLIDES">) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "method-not-allowed", "Model files are read only");
  }
  const key = modelKey(new URL(request.url).pathname);
  if (key === null) return problem(404, "not-found", "No such file");
  if (request.method === "HEAD") {
    const head = await env.SLIDES.head(key);
    return head === null
      ? problem(404, "not-found", "No such file")
      : new Response(null, { status: 200, headers: modelHeaders(head) });
  }
  const object = await env.SLIDES.get(key, { onlyIf: request.headers });
  if (object === null) return problem(404, "not-found", "No such file");
  if (!hasBody(object)) {
    const headers = modelHeaders(object);
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers: modelHeaders(object) });
}
