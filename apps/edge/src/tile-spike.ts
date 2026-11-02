import { handleTiles, isTilesPath, problem, type TileEnv } from "./tiles.ts";

const seconds = () => Math.floor(Date.now() / 1000);

export default {
  fetch(request: Request, env: TileEnv, context: ExecutionContext): Promise<Response> | Response {
    if (!isTilesPath(new URL(request.url).pathname)) {
      return problem(404, "not-found", "No such file");
    }
    const cache =
      request.headers.get("X-Spike-Cache") === "on"
        ? { store: caches.default, keep: (work: Promise<unknown>) => context.waitUntil(work) }
        : undefined;
    return handleTiles(request, env, seconds, () => undefined, cache);
  },
} satisfies ExportedHandler<TileEnv>;
