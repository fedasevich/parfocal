import { useLingui } from "@lingui/react/macro";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import { viewportRect } from "./stage-geometry.ts";
import type { StageSession } from "./stage-inspector.tsx";
import type { SlideOverview, ViewerEngine } from "./viewer-engine.ts";

function overviewUrl(overview: SlideOverview): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = overview.width;
  canvas.height = overview.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.putImageData(new ImageData(overview.rgba, overview.width, overview.height), 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export type MinimapSource = "thumbnail" | "overview" | "none";

function useMinimapImage(slideId: string, overview: StageSession["overview"] | undefined) {
  const [image, setImage] = useState<{ src: string | null; source: MinimapSource } | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    const thumbnail = slideThumbUrl(slideId);
    const fallBack = async () => {
      const read = overview === undefined ? null : await overview(stop.signal).catch(() => null);
      const src = read === null ? null : overviewUrl(read);
      if (!stop.signal.aborted) setImage({ src, source: src === null ? "none" : "overview" });
    };
    fetch(thumbnail, { credentials: "same-origin", signal: stop.signal })
      .then((response) => {
        if (response.ok) setImage({ src: thumbnail, source: "thumbnail" });
        else void fallBack();
      })
      .catch(() => {
        if (!stop.signal.aborted) void fallBack();
      });
    return () => stop.abort();
  }, [slideId, overview]);
  return image;
}

export function StageMinimap({
  engine,
  slideId,
  overview,
}: {
  engine: ViewerEngine;
  slideId: string;
  overview?: StageSession["overview"];
}) {
  const { t } = useLingui();
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const image = useMinimapImage(slideId, overview);
  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const slide = engine.getSlide();
  const viewport = viewportRect(camera, size);
  return (
    <div ref={frame} className="pointer-events-none absolute inset-0">
      {slide === null || image === null ? null : (
        <SmartMinimap
          data-testid="stage-minimap"
          data-source={image.source}
          className="pointer-events-auto"
          size="full"
          image={{ src: image.src ?? "", width: slide.width, height: slide.height }}
          title={<b>{t`Whole slide`}</b>}
          viewport={viewport}
          onMoveView={([x, y]) => engine.setCamera({ ...engine.getCamera(), x, y })}
          style={{ right: 16, top: 16 }}
        >
          <MapViewport rect={viewport} />
        </SmartMinimap>
      )}
    </div>
  );
}
