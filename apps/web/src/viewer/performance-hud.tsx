import { useEffect, useRef } from "react";
import { createFrameMeter, hudLines, hudRefreshMs } from "../lab/hud-meter.ts";
import { type LabSettings, setLabSetting } from "../lab/lab-settings.ts";
import type { VivRoute } from "./viewer-engine.ts";

const cornerClasses: Record<LabSettings["hudCorner"], string> = {
  tl: "top-3 left-3",
  tr: "top-3 right-3",
  bl: "bottom-3 left-3",
};

export default function PerformanceHud({
  route,
  corner,
  drawn,
  total,
  lodTier,
}: {
  route: VivRoute | null;
  corner: LabSettings["hudCorner"];
  drawn: number;
  total: number;
  lodTier: string;
}) {
  const text = useRef<HTMLPreElement>(null);
  const live = useRef({ drawn, total, lodTier });
  live.current = { drawn, total, lodTier };

  useEffect(() => {
    const meter = createFrameMeter();
    let frame = 0;
    const tick = (now: number) => {
      meter.record(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const refresh = window.setInterval(() => {
      const target = text.current;
      if (target === null) return;
      const current = live.current;
      target.textContent = hudLines({
        route: "viv",
        frame: meter.summary(),
        residentTiles: route?.residentTiles() ?? null,
        inflight: route?.loadState().pending ?? 0,
        decodeP95Ms: route?.decodeStats()?.decodeP95Ms ?? null,
        atlasUsed: null,
        annotationsDrawn: current.drawn,
        annotationsTotal: current.total,
        lodTier: current.lodTier,
      }).join("\n");
    }, hudRefreshMs);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(refresh);
    };
  }, [route]);

  return (
    <div
      data-testid="lab-hud"
      data-corner={corner}
      className={`absolute ${cornerClasses[corner]} flex items-start gap-2 rounded-ctl border border-line bg-chrome px-2 py-1 font-mono text-caption text-fg`}
    >
      <pre ref={text} data-testid="lab-hud-text" className="m-0 font-mono" />
      <button
        type="button"
        aria-label="Hide the HUD"
        className="cursor-pointer border-0 bg-transparent p-0 text-fg-dim"
        onClick={() => setLabSetting("hud", false)}
      >
        x
      </button>
    </div>
  );
}
