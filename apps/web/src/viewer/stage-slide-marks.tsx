import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster } from "@parfocal/ui/components/cells-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { outlineArea } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export const sampleChipBelowPx = 7;
const tagGapPx = 8;
const wholeSlideMarginZoom = 0.5;

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(outline: readonly number[]): Box {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < outline.length; index += 2) {
    const x = outline[index] ?? 0;
    const y = outline[index + 1] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}

export type SampleCells = { box: Box; cellSize: number; ids: readonly string[] };

export function sampleOf(objects: readonly ReviewObject[]): SampleCells | null {
  const boxes = objects.flatMap((item) =>
    item.kind === "cell" && item.outline && item.outline.length >= 6
      ? [{ id: item.object, box: boxOf(item.outline) }]
      : [],
  );
  if (boxes.length === 0) return null;
  const sizes = boxes
    .map(({ box }) => Math.max(box.right - box.left, box.bottom - box.top))
    .sort((a, b) => a - b);
  return {
    ids: boxes.map((item) => item.id),
    cellSize: sizes[Math.floor(sizes.length / 2)] ?? 0,
    box: {
      left: Math.min(...boxes.map(({ box }) => box.left)),
      top: Math.min(...boxes.map(({ box }) => box.top)),
      right: Math.max(...boxes.map(({ box }) => box.right)),
      bottom: Math.max(...boxes.map(({ box }) => box.bottom)),
    },
  };
}

export function useSampleCollapsed(engine: ViewerEngine, sample: SampleCells | null) {
  const cellSize = sample?.cellSize ?? 0;
  const collapsed = useCallback(
    () => cellSize > 0 && cellSize * 2 ** engine.getCamera().zoom < sampleChipBelowPx,
    [engine, cellSize],
  );
  return useSyncExternalStore(engine.subscribeCamera, collapsed);
}

type Size = { width: number; height: number };

function useWholeSlideShown(engine: ViewerEngine, size: React.RefObject<Size>) {
  const zoomedIn = useCallback(() => {
    const slide = engine.getSlide();
    const { width, height } = size.current;
    if (slide === null || width <= 0 || height <= 0) return false;
    const fitted = Math.log2(Math.min(width / slide.width, height / slide.height));
    return engine.getCamera().zoom > fitted + wholeSlideMarginZoom;
  }, [engine, size]);
  return useSyncExternalStore(engine.subscribeCamera, zoomedIn);
}

export function StageSlideMarks({
  engine,
  objects,
  decisionOf,
  showScore,
  sample,
  collapsed,
  onWholeSlide,
}: {
  engine: ViewerEngine;
  objects: readonly ReviewObject[];
  decisionOf: (id: string) => string | undefined;
  showScore: boolean;
  sample: SampleCells | null;
  collapsed: boolean;
  onWholeSlide: (() => void) | null;
}) {
  const { t } = useLingui();
  const frame = useRef<HTMLDivElement>(null);
  const size = useRef<Size>({ width: 0, height: 0 });
  const tags = useRef(new Map<string, HTMLElement>());
  const chip = useRef<HTMLButtonElement>(null);
  const regions = useMemo(
    () =>
      objects.flatMap((item) =>
        item.kind === "region" && item.outline && item.outline.length >= 6
          ? [{ id: item.object, score: item.score, box: boxOf(item.outline) }]
          : [],
      ),
    [objects],
  );
  const place = useCallback(() => {
    const camera = engine.getCamera();
    const scale = 2 ** camera.zoom;
    const { width, height } = size.current;
    const screen = (x: number, y: number) =>
      [(x - camera.x) * scale + width / 2, (y - camera.y) * scale + height / 2] as const;
    for (const region of regions) {
      const node = tags.current.get(region.id);
      if (node === undefined) continue;
      const [x, y] = screen(region.box.right, region.box.top);
      node.style.transform = `translate(${Math.round(x + tagGapPx)}px, ${Math.round(y)}px)`;
    }
    if (chip.current !== null && sample !== null) {
      const [x, y] = screen(
        (sample.box.left + sample.box.right) / 2,
        (sample.box.top + sample.box.bottom) / 2,
      );
      chip.current.style.transform = `translate(${Math.round(x - 24)}px, ${Math.round(y)}px) translateY(-50%)`;
    }
  }, [engine, regions, sample]);
  const wholeShown = useWholeSlideShown(engine, size);
  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const measure = () => {
      size.current = { width: node.clientWidth, height: node.clientHeight };
      place();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const stop = engine.subscribeCamera(place);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [engine, place]);
  const split = { agree: 0, disagree: 0, unsure: 0, open: 0 };
  for (const id of sample?.ids ?? []) {
    const value = decisionOf(id);
    if (value === "agree" || value === "disagree" || value === "unsure") split[value] += 1;
    else split.open += 1;
  }
  const flyToSample = () => {
    if (sample === null) return;
    const area = outlineArea([
      sample.box.left,
      sample.box.top,
      sample.box.right,
      sample.box.top,
      sample.box.right,
      sample.box.bottom,
    ]);
    if (area !== null) void engine.flyToArea(area);
  };
  return (
    <div
      ref={frame}
      className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
      data-testid="slide-marks"
      data-collapsed={collapsed}
    >
      {regions.map((region) => {
        const label = showScore ? `${region.id} ${Math.round(region.score * 100)}%` : region.id;
        return (
          <span
            key={region.id}
            ref={(node) => {
              if (node === null) tags.current.delete(region.id);
              else tags.current.set(region.id, node);
            }}
            data-testid="region-tag"
            data-object={region.id}
            className="absolute top-0 left-0 inline-flex h-5 items-center rounded-full border-[1.5px] border-accent bg-[#1d1d1d] px-[7px] font-mono text-caption font-semibold whitespace-nowrap text-white"
          >
            {label}
          </span>
        );
      })}
      {sample !== null && collapsed ? (
        <CellCluster
          ref={(node) => {
            chip.current = node;
            if (node !== null) place();
          }}
          split={split}
          data-testid="sample-chip"
          onClick={flyToSample}
          className="pointer-events-auto absolute top-0 left-0"
        />
      ) : null}
      {wholeShown && onWholeSlide !== null ? (
        <div className="pointer-events-auto absolute bottom-16 left-4 flex gap-2">
          <Button
            size="lg"
            variant="secondary"
            className="bg-chrome shadow-pop"
            data-testid="whole-slide-button"
            onClick={onWholeSlide}
          >
            <Icon name="expand" />
            {t`Whole slide`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
