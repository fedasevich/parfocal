import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { type MapRect, type MinimapSize, minimapBox } from "@parfocal/ui/lib/minimap-box";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type MapPoint = [number, number];

type MapImage = { src: string; width: number; height: number };

const MapScale = createContext(1);

const useMapScale = () => useContext(MapScale);

const tumorFill = "rgb(248 113 113 / 0.25)";

function MapImageLayer({ image }: { image: MapImage }) {
  return (
    <image href={image.src} width={image.width} height={image.height} preserveAspectRatio="none" />
  );
}

function MapTrail({ rects, opacity = 0.22 }: { rects: MapRect[]; opacity?: number }) {
  return (
    <g data-slot="map-trail">
      {rects.map((rect) => (
        <rect
          key={rect.join(",")}
          x={rect[0]}
          y={rect[1]}
          width={rect[2]}
          height={rect[3]}
          fill="var(--accent)"
          fillOpacity={opacity}
        />
      ))}
    </g>
  );
}

type MapAreaBadge = "checked" | "current" | "open" | "none";

function MapArea({
  path,
  centre,
  label,
  badge = "open",
  fill = tumorFill,
}: {
  path: string;
  centre: MapPoint;
  label: string;
  badge?: MapAreaBadge;
  fill?: string;
}) {
  const scale = useMapScale();
  return (
    <g data-slot="map-area" data-badge={badge}>
      <path
        d={path}
        fill={fill}
        stroke="var(--c-tumor)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {badge === "none" ? null : (
        <g transform={`translate(${centre[0]},${centre[1]}) scale(${scale})`}>
          <circle
            r={7}
            fill={
              badge === "checked"
                ? "#15803d"
                : badge === "current"
                  ? "var(--accent-fill)"
                  : "#1d1d1d"
            }
            stroke="#fff"
            strokeWidth={1.2}
          />
          <text
            y={3.5}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill="#fff"
            fontFamily="IBM Plex Sans, sans-serif"
          >
            {badge === "checked" ? "✓" : label}
          </text>
        </g>
      )}
    </g>
  );
}

function MapOutline({ path, width = 1.5 }: { path: string; width?: number }) {
  return (
    <path
      d={path}
      fill="none"
      stroke="var(--c-tumor)"
      strokeWidth={width}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function MapDots({
  dots,
  done = 0,
  current,
}: {
  dots: MapPoint[];
  done?: number;
  current?: number | undefined;
}) {
  const scale = useMapScale();
  return (
    <g data-slot="map-dots">
      {dots.map((dot, index) => (
        <g key={dot.join(",")} transform={`translate(${dot[0]},${dot[1]}) scale(${scale})`}>
          <circle
            r={index === current ? 4.5 : 3.2}
            fill={index < done ? "#9ca3af" : index === current ? "var(--accent-fill)" : "#fbbf24"}
            stroke="#fff"
            strokeWidth={1}
          />
        </g>
      ))}
    </g>
  );
}

function MapPins({ pins }: { pins: MapPoint[] }) {
  const scale = useMapScale();
  return (
    <g data-slot="map-pins">
      {pins.map((pin) => (
        <g key={pin.join(",")} transform={`translate(${pin[0]},${pin[1]}) scale(${scale})`}>
          <circle r={4.5} fill="var(--pin)" stroke="#fff" strokeWidth={1.2} />
        </g>
      ))}
    </g>
  );
}

function MapRoute({ from, to }: { from: MapPoint; to: MapPoint }) {
  const scale = useMapScale();
  return (
    <g data-slot="map-route">
      <line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${to[0]},${to[1]}) scale(${scale})`}>
        <circle
          r={12}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          className="origin-center animate-ping [transform-box:fill-box] motion-reduce:animate-none"
        />
        <circle r={5} fill="var(--accent-fill)" stroke="#fff" strokeWidth={1.2} />
      </g>
    </g>
  );
}

function MapViewport({ rect, tinyBelow = 8 }: { rect: MapRect; tinyBelow?: number }) {
  const scale = useMapScale();
  const tiny = rect[2] / scale < tinyBelow;
  if (tiny) {
    return (
      <g
        data-slot="map-viewport"
        data-tiny="true"
        transform={`translate(${rect[0] + rect[2] / 2},${rect[1] + rect[3] / 2}) scale(${scale})`}
      >
        <rect
          x={-5}
          y={-5}
          width={10}
          height={10}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
        />
        <path d="M-11 0h4M7 0h4M0 -11v4M0 7v4" stroke="var(--accent)" strokeWidth={2} />
      </g>
    );
  }
  return (
    <rect
      data-slot="map-viewport"
      x={rect[0]}
      y={rect[1]}
      width={rect[2]}
      height={rect[3]}
      fill="var(--accent)"
      fillOpacity={0.1}
      stroke="var(--accent)"
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
  );
}

type SmartMinimapProps = Omit<React.ComponentProps<"div">, "title"> & {
  size?: MinimapSize;
  image: MapImage;
  extent?: MapRect | undefined;
  title?: React.ReactNode;
  foot?: React.ReactNode;
  footEnd?: React.ReactNode;
  faded?: boolean;
  onOpen?: (() => void) | undefined;
  onPopOut?: (() => void) | undefined;
  viewport?: MapRect | undefined;
  onMoveView?: ((centre: MapPoint) => void) | undefined;
  children?: React.ReactNode;
};

function SmartMinimap({
  size = "full",
  image,
  extent,
  title,
  foot,
  footEnd,
  faded = false,
  onOpen,
  onPopOut,
  viewport,
  onMoveView,
  children,
  className,
  style,
  ...props
}: SmartMinimapProps) {
  const [pointer, setPointer] = useState(false);
  const drag = useRef<{ moved: boolean } | null>(null);
  const box: MapRect = extent ?? [0, 0, image.width, image.height];
  const sizes = minimapBox(size, box);
  const scale = box[2] / sizes.mapWidth;
  const head = size === "full" || size === "travel";
  const footShown = size !== "pip";
  const mapPoint = (event: React.PointerEvent<HTMLElement>): MapPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [
      box[0] + ((event.clientX - bounds.left) / bounds.width) * box[2],
      box[1] + ((event.clientY - bounds.top) / bounds.height) * box[3],
    ];
  };
  const onViewport = (point: MapPoint) => {
    if (!viewport) return false;
    const slack = 6 * scale;
    return (
      point[0] >= viewport[0] - slack &&
      point[0] <= viewport[0] + viewport[2] + slack &&
      point[1] >= viewport[1] - slack &&
      point[1] <= viewport[1] + viewport[3] + slack
    );
  };
  const map = (
    <svg
      aria-hidden="true"
      viewBox={box.join(" ")}
      preserveAspectRatio="none"
      className="block rounded-[5px] bg-[#f1eef2]"
      style={{ width: sizes.mapWidth, height: sizes.mapHeight }}
    >
      <MapScale value={scale}>
        <MapImageLayer image={image} />
        {children}
      </MapScale>
    </svg>
  );
  return (
    <div
      data-slot="smart-minimap"
      data-size={size}
      data-faded={faded || pointer || undefined}
      className={cn(
        "absolute z-3 rounded-zone border border-line bg-chrome p-1.5 shadow-pop transition-[left,top,opacity] duration-(--motion-slow) data-faded:opacity-28 motion-reduce:transition-none",
        className,
      )}
      style={{ width: sizes.width, ...style }}
      onPointerEnter={() => setPointer(true)}
      onPointerLeave={() => setPointer(false)}
      {...props}
    >
      {head ? (
        <div className="mx-0.5 mb-1.25 flex items-center justify-between gap-1 text-caption whitespace-nowrap text-fg-dim">
          <span className="min-w-0 truncate tracking-[-0.01em] [&_b]:font-semibold [&_b]:text-fg">
            {title}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-fg-faint">
            <Keycap keys="Z" size="sm" title="Hold Z to see the whole slide" />
            <button
              type="button"
              aria-label="Open on the second monitor"
              title="Open on the second monitor"
              onClick={onPopOut}
              className="grid size-5 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-fg-faint hover:bg-chrome-2 hover:text-fg"
            >
              <Icon name="popout" size="xs" />
            </button>
          </span>
        </div>
      ) : null}
      <div className="group relative">
        {map}
        {onOpen ? (
          <button
            type="button"
            aria-label="Open the whole slide"
            title="Click to open the whole slide (or hold Z)"
            onClick={() => {
              const dragged = drag.current?.moved === true;
              drag.current = null;
              if (!dragged) onOpen();
            }}
            onPointerDown={(event) => {
              if (!onMoveView || !onViewport(mapPoint(event))) return;
              drag.current = { moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              drag.current.moved = true;
              onMoveView?.(mapPoint(event));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            data-draggable={onMoveView ? "true" : undefined}
            className="absolute inset-0 cursor-zoom-in rounded-[5px] border-0 bg-transparent p-0 outline-none hover:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {size === "pip" ? null : (
              <span className="pointer-events-none absolute top-1.25 right-1.25 inline-flex h-5.5 items-center gap-1 rounded-md bg-[rgb(17_17_17/0.78)] px-1.5 text-caption font-medium text-white">
                <Icon name="expand" size="xs" />
                <span className="hidden group-hover:inline">Open</span>
              </span>
            )}
          </button>
        ) : null}
      </div>
      {footShown ? (
        <div className="mx-0.5 mt-1.25 flex justify-between gap-2 text-caption whitespace-nowrap text-fg-faint">
          <span>{foot}</span>
          <span>{footEnd}</span>
        </div>
      ) : null}
    </div>
  );
}

function useWidth(ref: React.RefObject<Element | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

type PeekLegendItem = { label: string; swatch: React.CSSProperties };

const peekLegend: PeekLegendItem[] = [
  { label: "Seen at 10x or more", swatch: { background: "rgb(37 99 235 / 0.35)" } },
  {
    label: "AI area",
    swatch: { background: "rgb(248 113 113 / 0.3)", border: "1.5px solid #e5484d" },
  },
  { label: "Checked", swatch: { background: "#15803d", borderRadius: "50%" } },
  { label: "You are here", swatch: { border: "2.5px solid #2563eb" } },
];

type WholeSlidePeekProps = Omit<React.ComponentProps<"div">, "title"> & {
  image: MapImage;
  title?: React.ReactNode;
  sub: React.ReactNode;
  held?: boolean;
  onClose: () => void;
  onPick?: ((point: MapPoint) => void) | undefined;
  children?: React.ReactNode;
};

function WholeSlidePeek({
  image,
  title = "Whole slide",
  sub,
  held = false,
  onClose,
  onPick,
  children,
  className,
  ...props
}: WholeSlidePeekProps) {
  const ref = useRef<SVGSVGElement>(null);
  const width = useWidth(ref);
  const scale = width > 0 ? image.width / width : 1;
  return (
    <div
      data-slot="whole-slide-peek"
      className={cn(
        "absolute inset-0 z-9 grid place-items-center bg-[rgb(8_8_8/0.62)] p-4 backdrop-blur-[3px]",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close the whole slide"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
      />
      <div
        role="dialog"
        aria-label="Whole slide"
        className="relative flex max-h-full flex-col gap-2.5 rounded-[14px] border border-line bg-chrome px-3.5 py-3 shadow-pop motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="grid">
            <b className="text-body font-semibold">{title}</b>
            <span className="text-caption text-fg-faint">{sub}</span>
          </div>
          <button
            type="button"
            aria-label="Back to the view"
            title="Back to the view (Esc)"
            onClick={onClose}
            className="grid size-8 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent text-fg-dim hover:bg-chrome-2 hover:text-fg"
          >
            <Icon name="close" />
          </button>
        </div>
        <svg
          ref={ref}
          role="img"
          aria-label="The whole slide. Click a place to go there"
          viewBox={`0 0 ${image.width} ${image.height}`}
          className="mx-auto block h-[min(72dvh,760px)] max-w-full cursor-pointer rounded-lg bg-[#f1eef2]"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onPick?.([
              ((event.clientX - bounds.left) / bounds.width) * image.width,
              ((event.clientY - bounds.top) / bounds.height) * image.height,
            ]);
          }}
        >
          <MapScale value={scale}>
            <MapImageLayer image={image} />
            {children}
          </MapScale>
        </svg>
        <div className="flex flex-wrap items-center gap-3.5 text-body-sm text-fg-dim">
          {peekLegend.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <i
                aria-hidden="true"
                className="inline-block size-3 rounded-[3px]"
                style={item.swatch}
              />
              {item.label}
            </span>
          ))}
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1">
            Click a place to go there ·{" "}
            {held ? (
              <>
                release <Keycap keys="Z" size="sm" />
              </>
            ) : (
              <>
                press <Keycap keys="Z" size="sm" /> or <Keycap keys="Esc" size="sm" />
              </>
            )}{" "}
            to return
          </span>
        </div>
      </div>
    </div>
  );
}

function PeekArea({
  path,
  corner,
  label,
  checked,
}: {
  path: string;
  corner: MapPoint;
  label: string;
  checked: boolean;
}) {
  const scale = useMapScale();
  return (
    <g data-slot="peek-area" data-checked={checked || undefined}>
      <path
        d={path}
        fill="rgb(248 113 113 / 0.14)"
        stroke="#e5484d"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${corner[0] + 4 * scale},${corner[1] + 4 * scale}) scale(${scale})`}>
        <circle r={9} fill={checked ? "#15803d" : "#1f1f1f"} stroke="#fff" strokeWidth={1.5} />
        {checked ? (
          <path
            d="M-4 0.5l2.6 2.6L4.2-3"
            fill="none"
            stroke="#fff"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <text
            y={3.8}
            textAnchor="middle"
            fill="#fff"
            fontSize={10.5}
            fontWeight={600}
            fontFamily="IBM Plex Sans, sans-serif"
          >
            {label}
          </text>
        )}
      </g>
    </g>
  );
}

function PeekHere({ rect }: { rect: MapRect }) {
  const scale = useMapScale();
  if (rect[2] / scale < 14) {
    return (
      <g
        data-slot="peek-here"
        transform={`translate(${rect[0] + rect[2] / 2},${rect[1] + rect[3] / 2}) scale(${scale})`}
      >
        <circle
          r={12}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          className="origin-center animate-ping [transform-box:fill-box] motion-reduce:animate-none"
        />
        <rect
          x={-6}
          y={-6}
          width={12}
          height={12}
          rx={2}
          fill="rgb(37 99 235 / 0.25)"
          stroke="#2563eb"
          strokeWidth={2.5}
        />
      </g>
    );
  }
  return (
    <rect
      data-slot="peek-here"
      x={rect[0]}
      y={rect[1]}
      width={rect[2]}
      height={rect[3]}
      fill="rgb(37 99 235 / 0.18)"
      stroke="#2563eb"
      strokeWidth={2.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export {
  MapArea,
  type MapAreaBadge,
  MapDots,
  type MapImage,
  MapOutline,
  MapPins,
  type MapPoint,
  type MapRect,
  MapRoute,
  MapTrail,
  MapViewport,
  type MinimapSize,
  minimapBox,
  PeekArea,
  PeekHere,
  SmartMinimap,
  type SmartMinimapProps,
  useMapScale,
  WholeSlidePeek,
  type WholeSlidePeekProps,
};
