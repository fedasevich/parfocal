import { useEffect, useState } from "react";
import type { StageSession } from "./stage-inspector.tsx";
import type { SlideOverview } from "./viewer-engine.ts";

export const pictureStep = 256;
export const cachedSlides = 4;

export type SharpPicture = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly wanted: number;
};

export function wantedPictureWidth(cssWidth: number, pixelRatio: number): number {
  if (!(cssWidth > 0)) return 0;
  const pixels = cssWidth * Math.max(1, pixelRatio);
  return Math.ceil(pixels / pictureStep) * pictureStep;
}

export function createPictureCache(limit: number, release: (picture: SharpPicture) => void) {
  const entries = new Map<string, SharpPicture>();
  return {
    find(slideId: string, wanted: number): SharpPicture | null {
      const found = entries.get(slideId);
      if (found === undefined || found.wanted < wanted) return null;
      entries.delete(slideId);
      entries.set(slideId, found);
      return found;
    },
    store(slideId: string, picture: SharpPicture): void {
      const before = entries.get(slideId);
      entries.delete(slideId);
      entries.set(slideId, picture);
      if (before !== undefined && before.src !== picture.src) release(before);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        const dropped = entries.get(oldest.value);
        entries.delete(oldest.value);
        if (dropped !== undefined) release(dropped);
      }
    },
    size: () => entries.size,
  };
}

const pictures = createPictureCache(cachedSlides, (picture) => URL.revokeObjectURL(picture.src));

function blobUrl(overview: SlideOverview): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = overview.width;
  canvas.height = overview.height;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.resolve(null);
  context.putImageData(new ImageData(overview.rgba, overview.width, overview.height), 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob === null ? null : URL.createObjectURL(blob)),
      "image/jpeg",
      0.92,
    );
  });
}

export function usePictureWidth(node: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const map = node?.querySelector('svg[role="img"]:not([aria-hidden="true"])');
    if (map === null || map === undefined) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, [node]);
  return width;
}

export function useSharpPicture(
  slideId: string,
  overview: StageSession["overview"],
  wanted: number,
): SharpPicture | null {
  const [found, setFound] = useState<{ slideId: string; picture: SharpPicture } | null>(null);
  useEffect(() => {
    if (wanted <= 0) return;
    const cached = pictures.find(slideId, wanted);
    if (cached !== null) {
      setFound({ slideId, picture: cached });
      return;
    }
    const stop = new AbortController();
    void overview(stop.signal, wanted)
      .then(async (read) => {
        if (read === null || stop.signal.aborted) return;
        const src = await blobUrl(read);
        if (src === null) return;
        const picture = { src, width: read.width, height: read.height, wanted };
        if (stop.signal.aborted) {
          URL.revokeObjectURL(src);
          return;
        }
        pictures.store(slideId, picture);
        setFound({ slideId, picture });
      })
      .catch(() => undefined);
    return () => stop.abort();
  }, [slideId, overview, wanted]);
  return found !== null && found.slideId === slideId ? found.picture : null;
}
