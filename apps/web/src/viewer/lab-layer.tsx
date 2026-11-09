import { useEffect, useMemo, useRef, useState } from "react";
import { useLabSettings } from "../lab/lab-settings.ts";
import { generateNuclei, nucleiChipFor } from "../lab/synthetic-data.ts";
import { detailDraw, insideView, labViewerPlan } from "./lab-plan.ts";
import PerformanceHud from "./performance-hud.tsx";
import type { ViewerEngine, VivRoute } from "./viewer-engine.ts";

const densityCell = 24;
const nucleiSeed = 7;
const fallbackExtent = { width: 100_000, height: 100_000 };

type Readout = { drawn: number; zoom: number; queued: number; used: number };

const noReadout: Readout = { drawn: 0, zoom: 0, queued: 0, used: 0 };

export default function LabLayer({
  engine,
  route,
}: {
  engine: ViewerEngine;
  route: VivRoute | null;
}) {
  const settings = useLabSettings();
  const plan = useMemo(() => labViewerPlan(settings), [settings]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<Readout>(noReadout);
  const slide = engine.getSlide();
  const nuclei = useMemo(
    () =>
      plan.nucleiCount === 0
        ? null
        : generateNuclei(plan.nucleiCount, nucleiSeed, {
            width: slide?.width ?? fallbackExtent.width,
            height: slide?.height ?? fallbackExtent.height,
          }),
    [plan.nucleiCount, slide?.width, slide?.height],
  );

  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext("2d") ?? null;
    if (target === null || context === null) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const width = target.clientWidth;
      const height = target.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (target.width !== Math.round(width * ratio)) target.width = Math.round(width * ratio);
      if (target.height !== Math.round(height * ratio)) target.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const camera = engine.getCamera();
      const scale = 2 ** camera.zoom;
      const view = plan.cull
        ? {
            left: camera.x - width / 2 / scale,
            right: camera.x + width / 2 / scale,
            top: camera.y - height / 2 / scale,
            bottom: camera.y + height / 2 / scale,
          }
        : null;
      let drawn = 0;
      if (nuclei !== null) {
        const columns = Math.ceil(width / densityCell) + 1;
        const rows = Math.ceil(height / densityCell) + 1;
        const bins = new Uint16Array(columns * rows);
        for (let index = 0; index < nuclei.count; index += 1) {
          const x = nuclei.x[index] ?? 0;
          const y = nuclei.y[index] ?? 0;
          if (view !== null && !insideView(view, x, y)) continue;
          drawn += 1;
          const sx = width / 2 + (x - camera.x) * scale;
          const sy = height / 2 + (y - camera.y) * scale;
          if (sx < 0 || sy < 0 || sx > width || sy > height) continue;
          const radius = (nuclei.radius[index] ?? 4) * scale;
          const draw = detailDraw(plan.detailLevel, radius);
          context.globalAlpha = draw.alpha;
          context.fillStyle = "#e0488a";
          if (draw.mode === "circle") {
            context.beginPath();
            context.arc(sx, sy, Math.max(radius, 0.5), 0, Math.PI * 2);
            context.fill();
          } else if (draw.mode === "dot") {
            context.fillRect(sx - 1, sy - 1, 2, 2);
          } else {
            const cell = Math.floor(sy / densityCell) * columns + Math.floor(sx / densityCell);
            bins[cell] = (bins[cell] ?? 0) + 1;
          }
        }
        context.fillStyle = "#e0488a";
        for (let cell = 0; cell < bins.length; cell += 1) {
          const count = bins[cell] ?? 0;
          if (count === 0) continue;
          context.globalAlpha = Math.min(0.85, 0.12 + count / 24);
          context.fillRect(
            (cell % columns) * densityCell,
            Math.floor(cell / columns) * densityCell,
            densityCell,
            densityCell,
          );
        }
        context.globalAlpha = 1;
      }
      const vector = plan.motionVector ? (route?.prefetchVector() ?? null) : null;
      if (vector !== null) {
        const length = Math.hypot(vector.vx, vector.vy) || 1;
        const reach = 40 + Math.min(80, vector.speed * 20);
        const tipX = width / 2 + (vector.vx / length) * reach;
        const tipY = height / 2 + (vector.vy / length) * reach;
        context.strokeStyle = "#2dd4bf";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(width / 2, height / 2);
        context.lineTo(tipX, tipY);
        context.stroke();
        context.beginPath();
        context.arc(tipX, tipY, 4, 0, Math.PI * 2);
        context.fill();
      }
      const stats = route?.prefetchStats() ?? null;
      setReadout((previous) => {
        const next = {
          drawn,
          zoom: Math.round(camera.zoom * 100) / 100,
          queued: stats?.queued ?? 0,
          used: stats?.used ?? 0,
        };
        return previous.drawn === next.drawn &&
          previous.zoom === next.zoom &&
          previous.queued === next.queued &&
          previous.used === next.used
          ? previous
          : next;
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };
    schedule();
    const unsubscribe = engine.subscribeCamera(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      unsubscribe();
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [engine, route, plan, nuclei]);

  const chip = nucleiChipFor(plan.nucleiCount);
  return (
    <>
      <canvas
        ref={canvas}
        data-testid="lab-nuclei"
        data-count={plan.nucleiCount}
        data-drawn={readout.drawn}
        data-detail={plan.detailLevel}
        data-cull={plan.cull ? "on" : "off"}
        data-vector={plan.motionVector ? "on" : "off"}
        className="pointer-events-none absolute inset-0 size-full"
      />
      <div className="pointer-events-none absolute bottom-3 left-3 grid gap-1 font-mono text-caption text-fg">
        {plan.routeNote ? (
          <p
            data-testid="lab-route-note"
            className="m-0 rounded-ctl border border-line bg-chrome px-2 py-1"
          >
            {plan.routeNote}
          </p>
        ) : null}
        {chip ? (
          <p data-testid="lab-chip" className="m-0 rounded-ctl bg-chrome px-2 py-1">
            {chip}
          </p>
        ) : null}
      </div>
      {plan.hud ? (
        <PerformanceHud
          route={route}
          corner={settings.hudCorner}
          drawn={readout.drawn}
          total={plan.nucleiCount}
          lodTier={plan.detailLevel}
        />
      ) : null}
    </>
  );
}
