import { useLingui } from "@lingui/react/macro";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import { viewportRect } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export function StageMinimap({ engine, slideId }: { engine: ViewerEngine; slideId: string }) {
  const { t } = useLingui();
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
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
      {slide === null ? null : (
        <SmartMinimap
          data-testid="stage-minimap"
          className="pointer-events-auto"
          size="full"
          image={{ src: slideThumbUrl(slideId), width: slide.width, height: slide.height }}
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
