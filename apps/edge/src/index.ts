import { WeakSigningKeyError } from "#capability.ts";
import { guard, type LimitEnv } from "#rate-limits.ts";
import { handleRealtime, isRealtimePath } from "#realtime.ts";
import type { RoomEnv } from "#room.ts";
import { withSecurityHeaders } from "#security-headers.ts";
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

export type EdgeEnv = TileEnv & RoomEnv & AppEnv & LimitEnv;

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    return withSecurityHeaders(request, await answer(request, env), {
      uploadOrigin: env.UPLOAD_ORIGIN,
    });
  },
} satisfies ExportedHandler<EdgeEnv>;

async function answer(request: Request, env: EdgeEnv): Promise<Response> {
  try {
    return (await guard(request, env)) ?? (await route(request, env));
  } catch (error) {
    console.error(
      JSON.stringify({
        unhandled: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return error instanceof WeakSigningKeyError
      ? problem(503, "signing-key-not-configured", "Slide and room access are not configured")
      : problem(500, "internal-error", "The request could not be served");
  }
}

function route(request: Request, env: EdgeEnv): Promise<Response> | Response {
  const { pathname } = new URL(request.url);
  if (isTilesPath(pathname)) {
    return handleTiles(request, env, seconds);
  }
  if (isRealtimePath(pathname)) {
    return handleRealtime(request, env, seconds);
  }
  if (isDataPath(pathname)) {
    return problem(404, "not-found", "No such file");
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response(null, { status: 404 });
}
