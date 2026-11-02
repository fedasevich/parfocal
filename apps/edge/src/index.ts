import { handleRealtime, isRealtimePath } from "#realtime.ts";
import type { RoomEnv } from "#room.ts";
import { uploadOriginOf, withSecurityHeaders } from "#security-headers.ts";
import { handleTiles, isTilesPath, problem, type TileEnv } from "#tiles.ts";

export const packageName = "@parfocal/edge";

export type { ByteRange, Capability } from "#capability.ts";
export { overlapsRestricted, signCapability, signingKey, verifyCapability } from "#capability.ts";
export { Room } from "#room.ts";

export const DATA_PATH_PREFIXES = ["/tiles/", "/data/", "/models/"] as const;

const seconds = () => Math.floor(Date.now() / 1000);

export function isDataPath(pathname: string): boolean {
  return DATA_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type AppEnv = {
  readonly ASSETS?: Fetcher;
  readonly UPLOAD_ORIGIN?: string;
};

export type EdgeEnv = TileEnv & RoomEnv & AppEnv;

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const response = await route(request, env, context);
    return withSecurityHeaders(request, response, {
      uploadOrigin: uploadOriginOf(env.UPLOAD_ORIGIN),
    });
  },
} satisfies ExportedHandler<EdgeEnv>;

function route(
  request: Request,
  env: EdgeEnv,
  context: ExecutionContext,
): Promise<Response> | Response {
  const { pathname } = new URL(request.url);
  if (isTilesPath(pathname)) {
    return handleTiles(request, env, seconds);
  }
  if (isRealtimePath(pathname)) {
    return handleRealtime(request, env, seconds, (work) => context.waitUntil(work));
  }
  if (isDataPath(pathname)) {
    return problem(404, "not-found", "No such file");
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response(null, { status: 404 });
}
