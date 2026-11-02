import { handleRealtime, isRealtimePath } from "#realtime.ts";
import type { RoomEnv } from "#room.ts";
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

export type EdgeEnv = TileEnv & RoomEnv;

export default {
  fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> | Response {
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
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<EdgeEnv>;
