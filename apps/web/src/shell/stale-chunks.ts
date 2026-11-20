const reloadKey = "parfocal.stale-chunk-reload";
const retryAfterMs = 60_000;

type ReloadPlace = {
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly now: () => number;
  readonly reload: () => void;
};

export function reloadForStaleChunk(place: ReloadPlace): boolean {
  const last = Number(place.storage.getItem(reloadKey) ?? 0);
  if (place.now() - last < retryAfterMs) return false;
  place.storage.setItem(reloadKey, String(place.now()));
  place.reload();
  return true;
}

export function reloadOnStaleChunks(target: Window) {
  target.addEventListener("vite:preloadError", (event) => {
    const reloaded = reloadForStaleChunk({
      storage: target.sessionStorage,
      now: () => Date.now(),
      reload: () => target.location.reload(),
    });
    if (reloaded) event.preventDefault();
  });
}
