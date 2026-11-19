import { useLingui } from "@lingui/react/macro";
import { useListDecisions, useListReviewObjects } from "@parfocal/api-client";
import { PeekArea, PeekHere, WholeSlidePeek } from "@parfocal/ui/components/smart-minimap";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { okData } from "../screens/placeholder.tsx";
import { runCells, seenRuns } from "./seen-runs.ts";
import { outlineArea, viewportRect } from "./stage-geometry.ts";
import type { StageSession } from "./stage-inspector.tsx";
import { useMinimapImage } from "./stage-minimap.tsx";
import type { CoverageRaster, TissueRaster, ViewerEngine } from "./viewer-engine.ts";

const jumpCells = 12;
const blankSlide = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

type PeekRegion = {
  object: string;
  outline: readonly number[];
  label: string;
  path: string;
  corner: [number, number];
  checked: boolean;
};

function outlinePath(outline: readonly number[]): string {
  let path = "";
  for (let index = 0; index + 1 < outline.length; index += 2) {
    path += `${index === 0 ? "M" : "L"}${outline[index]} ${outline[index + 1]}`;
  }
  return `${path}Z`;
}

function insideOutline(outline: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const points = outline.length >> 1;
  for (let index = 0, previous = points - 1; index < points; previous = index, index += 1) {
    const ax = outline[index * 2] ?? 0;
    const ay = outline[index * 2 + 1] ?? 0;
    const bx = outline[previous * 2] ?? 0;
    const by = outline[previous * 2 + 1] ?? 0;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function rightTop(outline: readonly number[]): [number, number] {
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < outline.length; index += 2) {
    right = Math.max(right, outline[index] ?? 0);
    top = Math.min(top, outline[index + 1] ?? 0);
  }
  return [right, top];
}

function usePeekRegions(taskId: string | undefined, slideId: string) {
  const enabled = taskId !== undefined;
  const objects = okData(useListReviewObjects(taskId ?? "", slideId, { query: { enabled } }).data);
  const decisions = okData(
    useListDecisions(taskId ?? "", slideId, undefined, { query: { enabled } }).data,
  );
  return useMemo(() => {
    if (objects === undefined) return null;
    const decided = new Set((decisions ?? []).map((item) => item.object));
    const regions: PeekRegion[] = objects.objects
      .filter((item) => item.kind === "region" && item.outline && item.outline.length >= 6)
      .map((item) => {
        const outline = item.outline ?? [];
        return {
          object: item.object,
          outline,
          label: String(item.number),
          path: outlinePath(outline),
          corner: rightTop(outline),
          checked: decided.has(item.object),
        };
      });
    const slide = objects.slide;
    return { regions, slideName: slide ? `${slide.label} · ${slide.stain}` : null };
  }, [objects, decisions]);
}

function tissueCells(raster: CoverageRaster, tissue: TissueRaster | null): number {
  const { columns, rows } = raster.grid;
  const total = columns * rows;
  if (tissue === null) return total;
  let count = 0;
  for (let index = 0; index < total; index += 1) {
    if (((tissue.tissue[index >> 3] ?? 0) & (1 << (index & 7))) !== 0) count += 1;
  }
  return count;
}

export function ViewedPeek({
  engine,
  slideId,
  taskId,
  overview,
  stage,
  host,
  raster,
  tissue,
  percent,
  onClose,
}: {
  engine: ViewerEngine;
  slideId: string;
  taskId: string | undefined;
  overview: StageSession["overview"];
  stage: HTMLElement | null;
  host: HTMLElement | null;
  raster: CoverageRaster;
  tissue: TissueRaster | null;
  percent: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { cell, columns, rows } = raster.grid;
  const runs = useMemo(() => seenRuns(raster, tissue), [raster, tissue]);
  const basis = useMemo(() => tissueCells(raster, tissue), [raster, tissue]);
  const picture = useMinimapImage(slideId, overview);
  const scope = usePeekRegions(taskId, slideId);
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const slide = engine.getSlide();
  const image = {
    src: picture?.src ?? blankSlide,
    width: slide?.width ?? columns * cell,
    height: slide?.height ?? rows * cell,
  };
  const view = viewportRect(camera, {
    width: stage?.clientWidth ?? 0,
    height: stage?.clientHeight ?? 0,
  });
  const regions = scope?.regions ?? [];
  const decided = regions.filter((region) => region.checked).length;
  const seen = t`${percent}% of tissue seen`;
  const sub =
    scope === null || regions.length === 0
      ? seen
      : [scope.slideName, t`${regions.length} tumor regions, ${decided} decided`, seen]
          .filter((part) => part !== null)
          .join(" · ");
  const peek = (
    <WholeSlidePeek
      data-testid="viewed-peek"
      data-source={picture?.source ?? "loading"}
      image={image}
      sub={sub}
      onClose={onClose}
      onPick={([x, y]) => {
        const size = jumpCells * cell;
        const region = regions.find((item) => insideOutline(item.outline, x, y));
        const area = region === undefined ? null : outlineArea(region.outline);
        void engine.flyToArea(
          area ?? { x: x - size / 2, y: y - size / 2, width: size, height: size },
        );
        onClose();
      }}
    >
      <g
        data-slot="viewed-cells"
        data-cells={runCells(runs)}
        data-basis-cells={basis}
        fill="#2563eb"
        fillOpacity={0.28}
      >
        {runs.map((run) => (
          <rect
            key={`${run.row}:${run.start}`}
            x={run.start * cell}
            y={run.row * cell}
            width={run.length * cell}
            height={cell}
          />
        ))}
      </g>
      {regions.map((region) => (
        <PeekArea
          key={region.object}
          path={region.path}
          corner={region.corner}
          label={region.label}
          checked={region.checked}
        />
      ))}
      {stage === null ? null : <PeekHere rect={view} />}
    </WholeSlidePeek>
  );
  return host === null ? peek : createPortal(peek, host);
}
