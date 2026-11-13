import { cn } from "@parfocal/ui/lib/utils";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StillLink } from "../../viewer/still-engine.tsx";
import { type StillFrame, type StillShape, stillShapeOf } from "../../viewer/still-frame.ts";
import type { SlideOutlines } from "../../viewer/use-still-objects.ts";
import { type Look, lookUrl } from "../thumbnails.ts";
import { isClick, type Pin, slidePoint } from "./comment-pin.ts";
import type { Count } from "./decision-style.ts";
import { cellShapes, hpfSize, midSize, overviewSize, regionShapes } from "./slide-geometry.ts";

export { midSize };

import { placeSlideTags } from "./tag-placement.ts";

export type StillView =
  | { kind: "region"; object: string }
  | { kind: "cell"; object: string }
  | { kind: "whole" };

export type Camera = { x: number; y: number; scale: number };

type Size = { width: number; height: number };

type Shapes = Readonly<Record<string, StillShape>>;

const noShapes: Shapes = {};

const nearCamera = (a: Camera, b: Camera) =>
  Math.abs(a.scale / b.scale - 1) < 1e-3 && Math.hypot(a.x - b.x, a.y - b.y) < 0.5;

function shapesOf(outlines: SlideOutlines, frame: StillFrame | undefined): Shapes {
  if (frame === undefined) return noShapes;
  return Object.fromEntries(
    [...outlines].map(([object, ring]) => [shapeKey(object), stillShapeOf(ring, frame)]),
  );
}

const regionMaxScale = 3.3;
const regionFill = 0.55;
const cellScale = 3.5;
export const readoutPerScale = { overview: 1 / 1.52, mid: 10, hpf: 25 } as const;

export const imageOf = (view: StillView) => (view.kind === "cell" ? "hpf" : "overview");

export type StillLook = Exclude<Look, "heat">;

const lookSizes: Record<StillLook, Size> = { overview: overviewSize, mid: midSize, hpf: hpfSize };

export const shapeKey = (object: string) => object.replace("⁺", "");

export const objectOfShape = (key: string) => (key === "T6" ? "T6⁺" : key);

export type RegionStyle = {
  stroke: string;
  fill?: string;
  dash?: string;
  double?: boolean;
  width?: number;
  opacity?: number;
};

export type SlideTag = { object: string; text: string; color: string };

export type Tiles = "sharp" | "loading" | "unloaded";

const cellHitRadius = 22;

function cellAt(point: { x: number; y: number }): string | undefined {
  let best: string | undefined;
  let bestDistance = cellHitRadius;
  for (const [id, cell] of Object.entries(cellShapes)) {
    const distance = Math.hypot(cell.x - point.x, cell.y - point.y);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

export function homeCamera(view: StillView, size: Size, shapes: Shapes = regionShapes): Camera {
  if (view.kind === "cell") {
    const cell = cellShapes[view.object];
    return { x: cell?.x ?? hpfSize.width / 2, y: cell?.y ?? hpfSize.height / 2, scale: cellScale };
  }
  if (view.kind === "region") {
    const [x0, y0, x1, y1] = shapes[shapeKey(view.object)]?.box ?? [0, 0, 1400, 1924];
    const fit = Math.min(
      (size.width * regionFill) / Math.max(1, x1 - x0),
      (size.height * regionFill) / Math.max(1, y1 - y0),
    );
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: Math.min(regionMaxScale, fit) };
  }
  return {
    x: overviewSize.width / 2,
    y: overviewSize.height / 2,
    scale: Math.min(
      (size.width - 48) / overviewSize.width,
      (size.height - 48) / overviewSize.height,
    ),
  };
}

export const magnificationOf = (view: StillView, camera: Camera) =>
  camera.scale * readoutPerScale[imageOf(view)];

export const readout = (view: StillView, camera: Camera) => {
  const value = magnificationOf(view, camera);
  return `${value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2)}×`;
};

function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 970, height: 835 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export const regionColours: Record<Count, string> = {
  agree: "var(--decision-agree)",
  disagree: "var(--decision-disagree)",
  unsure: "var(--decision-unsure)",
};

type SlideStillProps = {
  view: StillView;
  camera: Camera | null;
  onCameraChange: (camera: Camera | null) => void;
  regionDecisions: Record<string, Count | undefined>;
  cellDecisions?: Record<string, Count | undefined>;
  ringedCells?: string[];
  claimHidden?: boolean;
  drawAs?: string;
  showIds?: boolean;
  failed?: boolean;
  bare?: boolean;
  dim?: boolean;
  minimap?: boolean;
  hint?: boolean;
  slideName?: string;
  className?: string;
  tiles?: Tiles;
  regionStyle?: ((object: string) => RegionStyle | undefined) | undefined;
  cellStyle?: ((object: string) => RegionStyle | undefined) | undefined;
  currentTint?: string | undefined;
  tags?: SlideTag[];
  look?: StillLook | undefined;
  homeOf?: ((size: Size, shapes: Shapes) => Camera) | undefined;
  rotation?: number;
  underlay?: ((state: { camera: Camera; size: Size }) => ReactNode) | undefined;
  overlay?: (state: { camera: Camera; size: Size; home: Camera; moved: boolean }) => ReactNode;
  backdrop?:
    | ((state: {
        camera: Camera;
        size: Size;
        onReady: (link: StillLink | null) => void;
        onTiles: (failed: number) => void;
      }) => ReactNode)
    | undefined;
  engineDrawn?: ReadonlySet<string> | undefined;
  outlines?: SlideOutlines | undefined;
  outlineFrame?: StillFrame | undefined;
  onPointPick?: ((point: Pin) => void) | undefined;
  onCellPick?: ((object: string) => void) | undefined;
};

export function SlideStill({
  view,
  camera,
  onCameraChange,
  regionDecisions,
  cellDecisions = {},
  ringedCells = [],
  claimHidden = false,
  drawAs = "outline",
  showIds = true,
  failed = false,
  bare = false,
  dim = false,
  minimap = true,
  hint = true,
  slideName = "",
  className,
  tiles = "sharp",
  regionStyle,
  cellStyle,
  currentTint = "#ffffff",
  tags = [],
  look,
  homeOf,
  rotation = 0,
  underlay,
  overlay,
  backdrop,
  engineDrawn,
  outlines,
  outlineFrame,
  onPointPick,
  onCellPick,
}: SlideStillProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<StillLink | null>(null);
  const [failedTiles, setFailedTiles] = useState(0);
  const engineLink = backdrop === undefined ? null : link;
  const viaEngine = engineLink !== null;
  const frame = outlineFrame ?? engineLink?.frame;
  const shapes = useMemo(
    () => (outlines === undefined ? regionShapes : shapesOf(outlines, frame)),
    [outlines, frame],
  );
  const size = useElementSize(ref);
  const home = homeOf ? homeOf(size, shapes) : homeCamera(view, size, shapes);
  const clamp = (next: Camera): Camera => (engineLink === null ? next : engineLink.clamp(next));
  const shown = clamp(camera ?? home);
  const moveTo = (next: Camera) => onCameraChange(clamp(next));
  const written = useRef<Camera | null>(null);
  useEffect(() => {
    if (camera === null || shown === camera || nearCamera(shown, camera)) return;
    if (written.current !== null && nearCamera(written.current, shown)) return;
    written.current = shown;
    onCameraChange(shown);
  }, [camera, shown, onCameraChange]);
  const drag = useRef<{ x: number; y: number; from: Camera } | null>(null);
  const image = look ?? imageOf(view);
  const full = lookSizes[image];
  const viewBox = `${shown.x - size.width / 2 / shown.scale} ${shown.y - size.height / 2 / shown.scale} ${size.width / shown.scale} ${size.height / shown.scale}`;
  const moved =
    Math.abs(shown.scale / home.scale - 1) > 0.001 ||
    Math.hypot((shown.x - home.x) * shown.scale, (shown.y - home.y) * shown.scale) > 2;
  const toScreen = (x: number, y: number) => ({
    left: (x - shown.x) * shown.scale + size.width / 2,
    top: (y - shown.y) * shown.scale + size.height / 2,
  });
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button, a, [role=dialog], [role=checkbox], label")
    )
      return;
    drag.current = { x: event.clientX, y: event.clientY, from: shown };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) return;
    const turn = (-rotation * Math.PI) / 180;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    moveTo({
      ...start.from,
      x: start.from.x - (dx * Math.cos(turn) - dy * Math.sin(turn)) / start.from.scale,
      y: start.from.y - (dx * Math.sin(turn) + dy * Math.cos(turn)) / start.from.scale,
    });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    endDrag();
    if (start === null) return;
    if (!isClick(start, { x: event.clientX, y: event.clientY })) return;
    const box = event.currentTarget.getBoundingClientRect();
    const point = slidePoint(start.from, size, {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
    const hit = image === "hpf" && onCellPick ? cellAt(point) : undefined;
    if (hit !== undefined) {
      onCellPick?.(hit);
      return;
    }
    onPointPick?.(point);
  };
  const target = view.kind === "whole" ? null : view.object;
  const tagAt =
    view.kind === "region"
      ? (() => {
          const box = shapes[shapeKey(view.object)]?.box;
          return box ? toScreen(box[2], box[1]) : null;
        })()
      : view.kind === "cell"
        ? (() => {
            const cell = cellShapes[view.object];
            return cell ? toScreen(cell.x + 18, cell.y - 22) : null;
          })()
        : null;
  const placedTags =
    view.kind === "whole" && showIds && !bare
      ? placeSlideTags(
          tags,
          (object) => {
            const box = shapes[shapeKey(object)]?.box;
            return box === undefined ? null : toScreen(box[2], box[1]);
          },
          size,
        )
      : [];
  return (
    <div
      ref={ref}
      data-slot="slide-still"
      data-view={view.kind}
      data-scale={shown.scale.toFixed(2)}
      data-camera={`${shown.x.toFixed(2)},${shown.y.toFixed(2)},${shown.scale.toFixed(5)}`}
      className={cn(
        "relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-[#262626] select-none active:cursor-grabbing",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onWheel={(event) => {
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        moveTo({ ...shown, scale: shown.scale * factor });
      }}
    >
      {backdrop?.({ camera: shown, size, onReady: setLink, onTiles: setFailedTiles })}
      <svg
        role="img"
        aria-label={target ? `The slide around ${target}` : "The whole slide"}
        className={cn("absolute inset-0 size-full", failed && "opacity-30")}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        data-rotation={rotation}
        style={rotation === 0 ? undefined : { transform: `rotate(${rotation}deg)` }}
      >
        {tiles === "unloaded" || viaEngine ? null : (
          <image
            href={lookUrl(image)}
            width={full.width}
            height={full.height}
            style={tiles === "loading" ? { filter: "blur(1.6px)" } : undefined}
          />
        )}
        {underlay?.({ camera: shown, size })}
        {bare || image !== "overview"
          ? null
          : Object.entries(shapes).map(([id, shape]) => {
              const current = shapeKey(target ?? "") === id;
              const custom = current ? undefined : regionStyle?.(objectOfShape(id));
              const stroke = current
                ? currentTint
                : (custom?.stroke ?? (claimHidden ? "rgb(255 255 255 / 0.75)" : "var(--c-tumor)"));
              if (custom?.stroke === "none") return null;
              if (viaEngine && !current && engineDrawn?.has(objectOfShape(id))) return null;
              const doubled = !current && custom?.double === true;
              return (
                <g key={id}>
                  <path
                    d={shape.path}
                    fill={current ? "rgb(255 255 255 / 0.08)" : (custom?.fill ?? "none")}
                    stroke={stroke}
                    strokeWidth={current ? 3 : doubled ? 6 : (custom?.width ?? 1.5)}
                    strokeOpacity={custom?.opacity}
                    fillOpacity={custom?.opacity}
                    strokeDasharray={custom?.dash}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {doubled ? (
                    <path
                      d={shape.path}
                      fill="none"
                      stroke="#0b0b0b"
                      strokeWidth={2}
                      data-double-line=""
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
        {image === "hpf"
          ? Object.entries(cellShapes).map(([id, cell]) => {
              const current = id === target;
              const ringed = ringedCells.includes(id);
              const decision = cellDecisions[id];
              const custom = current ? undefined : cellStyle?.(id);
              if (custom?.stroke === "none") return null;
              const stroke = current
                ? currentTint
                : (custom?.stroke ??
                  (decision
                    ? regionColours[decision]
                    : claimHidden
                      ? "rgb(255 255 255 / 0.7)"
                      : "var(--c-tumor)"));
              const dotted = drawAs === "dots" && !current;
              return (
                <g key={id} data-object={id}>
                  {ringed ? (
                    <circle
                      cx={cell.x}
                      cy={cell.y}
                      r={9}
                      fill="none"
                      stroke="color-mix(in srgb, var(--accent) 75%, white)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  {dotted ? (
                    <circle
                      cx={cell.x}
                      cy={cell.y}
                      r={4 + (custom?.width ?? 1)}
                      fill={stroke}
                      fillOpacity={custom?.opacity ?? 0.8}
                    />
                  ) : (
                    <path
                      d={cell.path}
                      fill={custom?.fill ?? "none"}
                      fillOpacity={custom?.opacity}
                      stroke={stroke}
                      strokeOpacity={current ? 1 : (custom?.opacity ?? 0.55)}
                      strokeWidth={current ? 3 : (custom?.width ?? 1.2)}
                      strokeDasharray={custom?.dash}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {current ? (
                    <circle
                      cx={cell.x}
                      cy={cell.y}
                      r={21}
                      fill="rgb(255 255 255 / 0.08)"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })
          : null}
      </svg>
      {viaEngine && failedTiles > 0 ? (
        <span
          role="status"
          data-testid="still-tile-failures"
          data-failed={failedTiles}
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-body-sm font-medium text-white"
        >
          Some tiles did not load. Parts of the slide may look blank.
        </span>
      ) : null}
      {tiles === "unloaded" ? (
        <div
          aria-hidden="true"
          data-tiles="unloaded"
          className="absolute inset-0 bg-[repeating-conic-gradient(rgb(255_255_255/0.04)_0_25%,transparent_0_50%)] bg-size-[32px_32px]"
        />
      ) : null}
      {placedTags.map((tag) => {
        const color = tags.find((item) => item.object === tag.object)?.color;
        return (
          <span
            key={tag.object}
            data-tag={tag.object}
            className="pointer-events-none absolute inline-flex items-center justify-center rounded-full border-2 bg-[#1d1d1d] font-mono text-caption leading-none font-semibold whitespace-nowrap text-white"
            style={{
              left: tag.left,
              top: tag.top,
              width: tag.width,
              height: tag.height,
              borderColor: color,
            }}
          >
            {tag.text}
          </span>
        );
      })}
      {failed ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[repeating-conic-gradient(rgb(255_255_255/0.05)_0_25%,transparent_0_50%)] bg-size-[48px_48px]"
        />
      ) : null}
      {dim ? <div aria-hidden="true" className="absolute inset-0 bg-black/40" /> : null}
      {target && tagAt && showIds && !bare ? (
        <span
          className="pointer-events-none absolute rounded-md border-2 border-white bg-black px-2 py-0.5 font-mono text-body-sm font-semibold text-white"
          style={{ left: tagAt.left + 6, top: tagAt.top - 14 }}
        >
          {target}
        </span>
      ) : null}
      {hint && !moved && view.kind !== "whole" ? (
        <span className="pointer-events-none absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-body-sm font-medium text-white">
          Drag to move, scroll to zoom
        </span>
      ) : null}
      {minimap && view.kind !== "whole" ? (
        <Minimap
          view={view}
          camera={shown}
          size={size}
          regionDecisions={regionDecisions}
          slideName={slideName}
          shapes={shapes}
        />
      ) : null}
      {overlay?.({ camera: shown, size, home, moved })}
    </div>
  );
}

function Minimap({
  view,
  camera,
  size,
  regionDecisions,
  slideName,
  shapes,
}: {
  view: StillView;
  camera: Camera;
  size: Size;
  regionDecisions: Record<string, Count | undefined>;
  slideName: string;
  shapes: Shapes;
}) {
  const width = 136;
  const k = width / overviewSize.width;
  const height = overviewSize.height * k;
  const focus =
    view.kind === "cell"
      ? (shapes.T2?.box ?? [0, 0, 0, 0])
      : (shapes[view.kind === "region" ? shapeKey(view.object) : "T1"]?.box ?? [0, 0, 0, 0]);
  const viewport =
    view.kind === "region"
      ? {
          left: (camera.x - size.width / 2 / camera.scale) * k,
          top: (camera.y - size.height / 2 / camera.scale) * k,
          width: (size.width / camera.scale) * k,
          height: (size.height / camera.scale) * k,
        }
      : {
          left: ((focus[0] + focus[2]) / 2) * k - 6,
          top: ((focus[1] + focus[3]) / 2) * k - 6,
          width: 12,
          height: 12,
        };
  return (
    <div className="absolute top-4 right-4 grid gap-1 rounded-zone border border-line bg-chrome p-1.5 shadow-pop">
      <div
        className="relative overflow-hidden rounded-md bg-white bg-cover"
        style={{ width, height, backgroundImage: `url(${lookUrl("overview")})` }}
      >
        <span
          aria-hidden="true"
          className="absolute border-[1.5px] border-[color-mix(in_srgb,var(--accent)_70%,white)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          style={{
            left: Math.max(0, viewport.left),
            top: Math.max(0, viewport.top),
            width: Math.min(width, viewport.width),
            height: Math.min(height, viewport.height),
          }}
        />
        {Object.entries(shapes)
          .filter(([id]) => id in regionDecisions || id === "T5")
          .map(([id, shape], index) => {
            const decision = regionDecisions[id];
            const current = view.kind === "region" && id === view.object;
            return (
              <span
                key={id}
                aria-hidden="true"
                className={cn(
                  "absolute grid size-3.5 -translate-1/2 place-items-center rounded-full text-[8px] font-bold text-white",
                  current
                    ? "bg-accent-fill"
                    : decision
                      ? "bg-ok-fill"
                      : "border border-white bg-black/60",
                )}
                style={{
                  left: ((shape.box[0] + shape.box[2]) / 2) * k,
                  top: ((shape.box[1] + shape.box[3]) / 2) * k,
                }}
              >
                {current ? index + 1 : decision ? "✓" : ""}
              </span>
            );
          })}
      </div>
      <span className="flex justify-between gap-2 px-0.5 text-caption text-fg-dim">
        <span data-phi="">{slideName}</span>
        <span>Click to move</span>
      </span>
    </div>
  );
}
