import { handleTiles, isTilesPath, type TileEnv } from "#tiles.ts";

export const packageName = "@parfocal/edge";

export type { ByteRange, Capability } from "#capability.ts";
export { overlapsRestricted, signCapability, signingKey, verifyCapability } from "#capability.ts";

const seconds = () => Math.floor(Date.now() / 1000);

export default {
  fetch(request: Request, env: TileEnv): Promise<Response> | Response {
    if (isTilesPath(new URL(request.url).pathname)) {
      return handleTiles(request, env, seconds);
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<TileEnv>;
