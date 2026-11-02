import { handleTiles, isTilesPath, problem, type TileEnv } from "#tiles.ts";

export const packageName = "@parfocal/edge";

export type { ByteRange, Capability } from "#capability.ts";
export { overlapsRestricted, signCapability, signingKey, verifyCapability } from "#capability.ts";

export const DATA_PATH_PREFIXES = ["/tiles/", "/data/", "/models/"] as const;

const seconds = () => Math.floor(Date.now() / 1000);

export function isDataPath(pathname: string): boolean {
  return DATA_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default {
  fetch(request: Request, env: TileEnv): Promise<Response> | Response {
    const { pathname } = new URL(request.url);
    if (isTilesPath(pathname)) {
      return handleTiles(request, env, seconds);
    }
    if (isDataPath(pathname)) {
      return problem(404, "not-found", "No such file");
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<TileEnv>;
