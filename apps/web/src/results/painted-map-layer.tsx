import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { brushDefaultSize, brushModeOf, stepBrushSize } from "../annotations/brush.ts";
import { strokeSamples } from "../annotations/freehand.ts";
import type { Point } from "../annotations/polygon-draft.ts";
import {
  buttonReleased,
  capturePointer,
  interruptMotion,
  releasePointer,
  slideAt,
} from "../annotations/stage-pointer.ts";
import { useStageRect } from "../annotations/stage-size.ts";
import { fingerPans } from "../devices/pen-touch.ts";
import { DockCard, useDocked } from "../viewer/inspector-slots.tsx";
import {
  type HeatmapGrid,
  screenScale,
  slideToScreen,
  type ViewerEngine,
} from "../viewer/viewer-engine.ts";
import {
  createPaintedMapSession,
  type PaintedMapSession,
  paintedMapStoreFor,
} from "./painted-map-session.ts";

const paintedRgba = [236, 72, 153, 255] as const;
const paintedOpacity = 0.5;
const defaultName = "Painted map";

function paintedPicture(grid: HeatmapGrid): string {
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let index = 0; index < grid.values.length; index++) {
    if ((grid.values[index] ?? 0) === 0) continue;
    rgba.set(paintedRgba, index * 4);
  }
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  canvas.getContext("2d")?.putImageData(new ImageData(rgba, grid.width, grid.height), 0, 0);
  return canvas.toDataURL();
}

function download(fileName: string, bytes: Uint8Array): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

type Stroke = { mode: "paint" | "erase"; points: readonly Point[] };

type PanelProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  session: PaintedMapSession;
};

function PaintedMapPanel({ engine, stage, session }: PanelProps) {
  const { t } = useLingui();
  const docked = useDocked();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [size, setSize] = useState(brushDefaultSize);
  const [stroke, setStroke] = useState<Stroke | null>(null);
  const latest = useRef({ engine, session, size });
  latest.current = { engine, session, size };

  useEffect(() => {
    if (open) void session.refresh();
  }, [open, session]);

  useEffect(() => {
    if (state.current !== null) setName(state.current.name);
  }, [state.current]);

  useEffect(() => {
    if (!open) {
      setStroke(null);
      return;
    }
    let drawing: { id: number; mode: Stroke["mode"]; points: Point[] } | null = null;
    const toSlide = (event: PointerEvent): Point => slideAt(latest.current.engine, stage, event);
    const down = (event: PointerEvent) => {
      if (fingerPans(event) || event.button !== 0 || drawing !== null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      drawing = { id: event.pointerId, mode: brushModeOf(event), points: [toSlide(event)] };
      setStroke({ mode: drawing.mode, points: [...drawing.points] });
    };
    const move = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      event.stopImmediatePropagation();
      if (buttonReleased(event)) {
        up(event);
        return;
      }
      for (const sample of strokeSamples(event)) drawing.points.push(toSlide(sample));
      setStroke({ mode: drawing.mode, points: [...drawing.points] });
    };
    const up = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      event.stopImmediatePropagation();
      const done = drawing;
      drawing = null;
      releasePointer(stage, event.pointerId);
      setStroke(null);
      const { engine: current, session: target, size: brush } = latest.current;
      target.paint({
        points: done.points,
        diameter: brush / screenScale(current.getCamera()),
        mode: done.mode,
      });
    };
    const cancel = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      drawing = null;
      setStroke(null);
    };
    const resize = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "[") setSize((value) => stepBrushSize(value, -1));
      if (event.key === "]") setSize((value) => stepBrushSize(value, 1));
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", resize);
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", resize);
    };
  }, [open, stage]);

  const picture = useMemo(
    () => (state.grid === null ? null : paintedPicture(state.grid)),
    [state.grid],
  );
  const area = state.grid?.area;
  const from = area === undefined ? null : slideToScreen(camera, rect, area);
  const to =
    area === undefined
      ? null
      : slideToScreen(camera, rect, { x: area.x + area.width, y: area.y + area.height });
  const strokePath =
    stroke === null
      ? ""
      : stroke.points
          .map((point, index) => {
            const p = slideToScreen(camera, rect, point);
            return `${index === 0 ? "M" : "L"}${p.x} ${p.y}`;
          })
          .join(" ");
  const trimmed = name.trim();
  const working = state.phase === "working";
  const exportMap = () => {
    void session.exportFile().then((file) => {
      if (file !== null) download(file.fileName, file.bytes);
    });
  };

  return (
    <>
      {picture === null || from === null || to === null ? null : (
        <img
          alt=""
          aria-hidden="true"
          data-testid="painted-map-picture"
          data-painted={state.painted}
          src={picture}
          className="pointer-events-none absolute max-w-none"
          style={{
            left: from.x,
            top: from.y,
            width: to.x - from.x,
            height: to.y - from.y,
            opacity: paintedOpacity,
            imageRendering: "pixelated",
          }}
        />
      )}
      {stroke === null ? null : (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <path
            d={`${strokePath}${stroke.points.length === 1 ? "l0 0" : ""}`}
            fill="none"
            stroke={stroke.mode === "erase" ? "#fff" : "#ec4899"}
            strokeOpacity={0.6}
            strokeWidth={size}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <DockCard section="display" order={3}>
        <section
          aria-label={t`Painted map`}
          data-testid="painted-map"
          data-phase={state.phase}
          data-open={open ? "on" : "off"}
          data-painted={state.painted}
          data-dirty={state.dirty ? "yes" : "no"}
          data-version={state.opened ?? 0}
          className={
            docked
              ? "flex flex-col gap-2 rounded-ctl border border-line bg-surf-panel px-3 py-2 text-caption"
              : "pointer-events-auto absolute right-3 bottom-16 z-10 flex max-w-80 flex-col gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
          }
        >
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              data-testid="painted-map-toggle"
              aria-pressed={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <Trans>Stop painting</Trans> : <Trans>Paint a map</Trans>}
            </Button>
            <span role="status" data-testid="painted-map-status">
              {state.phase === "changed" ? (
                <Trans>This map changed since you opened it, open it again</Trans>
              ) : state.phase === "failed" ? (
                <Trans>That did not work, try again</Trans>
              ) : state.dirty ? (
                <Trans>Unsaved changes</Trans>
              ) : null}
            </span>
          </div>
          {open ? (
            <>
              <p className="text-muted">
                <Trans>Drag to paint. Hold Shift or Alt to erase. Press [ or ] to resize.</Trans>
              </p>
              <label className="flex items-center gap-2">
                <span>
                  <Trans>Name</Trans>
                </span>
                <input
                  data-testid="painted-map-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  data-testid="painted-map-save"
                  disabled={working || trimmed === "" || state.painted === 0}
                  onClick={() => void session.save(trimmed)}
                >
                  <Trans>Save</Trans>
                </Button>
                <Button
                  size="sm"
                  data-testid="painted-map-save-new"
                  disabled={working || trimmed === "" || state.painted === 0}
                  onClick={() => void session.saveAsNew(trimmed)}
                >
                  <Trans>Save as new</Trans>
                </Button>
                <Button
                  size="sm"
                  data-testid="painted-map-new"
                  disabled={working}
                  onClick={() => session.startNew()}
                >
                  <Trans>New map</Trans>
                </Button>
                <Button
                  size="sm"
                  data-testid="painted-map-export"
                  disabled={working || state.current === null}
                  onClick={exportMap}
                >
                  <Trans>Export</Trans>
                </Button>
              </div>
              <label className="flex items-center gap-2">
                <span>
                  <Trans>Open</Trans>
                </span>
                <select
                  data-testid="painted-map-list"
                  value={state.current?.id ?? ""}
                  disabled={working || state.maps.length === 0}
                  onChange={(event) => {
                    if (event.target.value !== "") void session.open(event.target.value);
                  }}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1"
                >
                  <option value="">{t`Choose a saved map`}</option>
                  {state.maps.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t`${item.name} (v${item.version})`}
                    </option>
                  ))}
                </select>
              </label>
              {state.current === null ? null : (
                <label className="flex items-center gap-2">
                  <span>
                    <Trans>Version</Trans>
                  </span>
                  <select
                    data-testid="painted-map-versions"
                    value={state.opened ?? ""}
                    disabled={working}
                    onChange={(event) => {
                      if (state.current !== null) {
                        void session.open(state.current.id, Number(event.target.value));
                      }
                    }}
                    className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1"
                  >
                    {state.versions.map((item) => (
                      <option key={item.version} value={item.version}>
                        {t`Version ${item.version}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : null}
        </section>
      </DockCard>
    </>
  );
}

type PaintedMapLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  slideId: string;
};

type SlidePaintedMapProps = Omit<PaintedMapLayerProps, "slideId"> & {
  slideId: string;
  slide: { readonly width: number; readonly height: number };
};

function SlidePaintedMap({ engine, stage, slideId, slide }: SlidePaintedMapProps) {
  const [session] = useState(() =>
    createPaintedMapSession({ slide, store: paintedMapStoreFor(slideId) }),
  );
  return <PaintedMapPanel engine={engine} stage={stage} session={session} />;
}

export function PaintedMapLayer({ engine, stage, slideId }: PaintedMapLayerProps) {
  const slide = useSyncExternalStore(engine.subscribeCamera, engine.getSlide);
  if (slide === null) return null;
  return (
    <SlidePaintedMap
      key={`${slideId}:${slide.width}x${slide.height}`}
      engine={engine}
      stage={stage}
      slideId={slideId}
      slide={slide}
    />
  );
}
