import { useLingui } from "@lingui/react/macro";
import {
  getGetCellChunkUrl,
  getGetCellSummaryUrl,
  type ResultSet,
  type SetRegion,
  useGetResultSet,
  useListProjectClasses,
  useListResultSetRegions,
  useListSlideResultSets,
} from "@parfocal/api-client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { okData } from "../screens/placeholder.tsx";
import { type ClassPaint, classPaints } from "./class-paint.ts";
import { DockCard, dockedCard } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import {
  chunkCells,
  mergeRegions,
  regionBox,
  regionPageLimit,
  setRegions,
  summaryCells,
  viewportRect,
} from "./stage-geometry.ts";
import { httpCellSource, PagedCells, type ViewerEngine } from "./viewer-engine.ts";

const sameOrigin: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

function useStageSize() {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { frame, size };
}

function usePagedCells(setId: string) {
  const [paged, setPaged] = useState<PagedCells | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const redraw = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((value) => value + 1);
      });
    };
    const aborter = new AbortController();
    let opened: PagedCells | null = null;
    PagedCells.open(
      httpCellSource(
        getGetCellSummaryUrl(setId),
        (index) => getGetCellChunkUrl(setId, index),
        sameOrigin,
      ),
      { signal: aborter.signal, onChange: redraw },
    ).then(
      (cells) => {
        if (aborter.signal.aborted) return cells.close();
        opened = cells;
        setPaged(cells);
      },
      (error: unknown) => {
        console.error("result set cells failed", error);
        setPaged(null);
      },
    );
    return () => {
      aborter.abort();
      cancelAnimationFrame(frame);
      opened?.close();
    };
  }, [setId]);
  return { paged, version };
}

function SetCells({
  engine,
  module,
  set,
  outlines,
  paints,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
  outlines: boolean;
  paints: readonly ClassPaint[];
}) {
  const { paged, version } = usePagedCells(set.id);
  const { frame, size } = useStageSize();
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: `result-cells-${set.id}`, host: engine }),
    [module, engine, set.id],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const [left, top, width, height] = viewportRect(camera, size);
  useEffect(() => {
    if (paged === null || !outlines || width <= 0) return;
    paged
      .show([left, top, left + width, top + height])
      .catch((error: unknown) => console.error("result set cells did not page in", error));
  }, [paged, outlines, left, top, width, height]);
  const [drawn, setDrawn] = useState({ cells: 0, as: "none" });
  useEffect(() => {
    if (paged === null || version < 0) return;
    const loaded = outlines ? chunkCells(set.id, paged, paints) : [];
    const outlined = loaded.length > 0;
    const cells = outlined ? loaded : summaryCells(set.id, paged.summary);
    drawing.setChoices(
      outlined ? { draw: "outline", colorBy: "class" } : { draw: "dots", colorBy: "score" },
    );
    drawing.setObjects(cells);
    setDrawn({ cells: cells.length, as: outlined ? "outlines" : "dots" });
  }, [drawing, paged, version, outlines, set.id, paints]);
  return (
    <div
      ref={frame}
      className="pointer-events-none invisible absolute inset-0"
      data-testid="result-set-cells"
      data-set={set.id}
      data-cells={drawn.cells}
      data-drawn={drawn.as}
      data-resident={paged?.cache.size ?? 0}
    />
  );
}

function SetRegions({
  engine,
  module,
  set,
  paints,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
  paints: readonly ClassPaint[];
}) {
  const { frame, size } = useStageSize();
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const paged = set.region_count > regionPageLimit;
  const box = regionBox(viewportRect(camera, size));
  const params = paged && size.width > 0 ? box : undefined;
  const page = okData(
    useListResultSetRegions(set.id, params, { query: { enabled: !paged || size.width > 0 } }).data,
  );
  const [kept, setKept] = useState<ReadonlyMap<number, SetRegion>>(new Map());
  useEffect(() => {
    if (page !== undefined) setKept((before) => mergeRegions(before, page.regions));
  }, [page]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: `result-regions-${set.id}`, host: engine }),
    [module, engine, set.id],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const regions = useMemo(
    () => setRegions(set.id, [...kept.values()], paints),
    [kept, set.id, paints],
  );
  useEffect(() => {
    drawing.setChoices({ draw: "outline", colorBy: "class" });
    drawing.setObjects(regions);
  }, [drawing, regions]);
  return (
    <div
      ref={frame}
      className="pointer-events-none invisible absolute inset-0"
      data-testid="result-set-regions"
      data-set={set.id}
      data-regions={regions.length}
      data-paged={paged}
      data-box={params === undefined ? "" : `${box.left},${box.top},${box.right},${box.bottom}`}
      data-truncated={page?.truncated ?? false}
    />
  );
}

function useSetPaints(setId: string) {
  const detail = okData(useGetResultSet(setId).data);
  const projectId = detail?.project_id ?? "";
  const projectClasses = okData(
    useListProjectClasses(projectId, { query: { enabled: projectId !== "" } }).data,
  );
  return useMemo(
    () => classPaints(detail?.classes ?? [], projectClasses ?? []),
    [detail, projectClasses],
  );
}

function ClassLegend({ set, paints }: { set: ResultSet; paints: readonly ClassPaint[] }) {
  const rows = paints.filter((paint): paint is ClassPaint => paint !== undefined);
  if (rows.length === 0) return null;
  return (
    <DockCard section="display" order={2}>
      <section className={dockedCard} data-testid="class-legend" data-set={set.id}>
        <h3 className="truncate font-medium text-fg">{set.name}</h3>
        <ul className="grid gap-1">
          {rows.map((paint) => (
            <li
              key={paint.name}
              className="flex items-center gap-2 text-fg-dim"
              data-testid="class-legend-row"
              data-class={paint.name}
              data-colour={paint.hex}
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-[3px]"
                style={{ background: paint.hex }}
              />
              <span className="truncate">{paint.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </DockCard>
  );
}

function ResultSetLayer({
  engine,
  module,
  set,
  inTask,
  shown,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
  inTask: boolean;
  shown: boolean;
}) {
  const paints = useSetPaints(set.id);
  if (!shown) return null;
  return (
    <>
      {(set.cell_count ?? 0) > 0 ? (
        <SetCells engine={engine} module={module} set={set} outlines={!inTask} paints={paints} />
      ) : null}
      {!inTask && (set.region_count ?? 0) > 0 ? (
        <SetRegions engine={engine} module={module} set={set} paints={paints} />
      ) : null}
      {inTask ? null : <ClassLegend set={set} paints={paints} />}
    </>
  );
}

export function StageResultCells({
  engine,
  module,
  slideId,
  inTask = false,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  slideId: string;
  inTask?: boolean;
}) {
  const { t } = useLingui();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const sets = okData(useListSlideResultSets(slideId).data) ?? [];
  const drawable = sets.filter(
    (set) =>
      set.status === "ready" && ((set.cell_count ?? 0) > 0 || (!inTask && set.region_count > 0)),
  );
  const toggle = (id: string) =>
    setHidden((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      {drawable.map((set) => (
        <ResultSetLayer
          key={set.id}
          engine={engine}
          module={module}
          set={set}
          inTask={inTask}
          shown={!hidden.has(set.id)}
        />
      ))}
      {drawable.length === 0 ? null : (
        <div className="pointer-events-auto absolute bottom-16 left-3 z-10 flex flex-col gap-1">
          {drawable.map((set) => {
            const shown = !hidden.has(set.id);
            return (
              <button
                key={set.id}
                type="button"
                aria-pressed={shown}
                data-testid="result-set-toggle"
                className="w-fit max-w-64 truncate rounded-md border border-line bg-surf-panel px-2 py-1 text-left text-caption text-fg shadow-pop"
                title={set.name}
                onClick={() => toggle(set.id)}
              >
                {shown ? t`Hide ${set.name}` : t`Show ${set.name}`}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
