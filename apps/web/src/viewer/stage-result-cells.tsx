import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetCellChunkUrl,
  getGetCellSummaryUrl,
  type ResultSet,
  type SetRegion,
  useGetMyDisplay,
  useGetResultSet,
  useGetReviewTask,
  useListProjectClasses,
  useListResultSetRegions,
  useListSlideResultSets,
} from "@parfocal/api-client";
import { Switch } from "@parfocal/ui/components/switch";
import { type RefObject, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clickSlopScreenPixels } from "../annotations/click-press.ts";
import { slideAt } from "../annotations/stage-pointer.ts";
import { okData } from "../screens/placeholder.tsx";
import { shownSetsOf, taskDisplayView } from "../screens/review/display-model.ts";
import { useDisplayChoice } from "../screens/review/use-display-choice.ts";
import { useDisplayDefaults } from "../shell/display-defaults.ts";
import { type ClassPaint, classPaints } from "./class-paint.ts";
import { DockCard, dockedCard, useDocked } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { type CellRetype, RetypeAiCell } from "./picked-cell-retype.tsx";
import { cellAt, type PickedCell, pickSlopScreenPixels } from "./result-cell-pick.ts";
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
  retype,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
  outlines: boolean;
  paints: readonly ClassPaint[];
  retype: CellRetype | null;
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
  const [picked, setPicked] = useState<PickedCell | null>(null);
  useEffect(() => {
    if (paged === null || version < 0) return;
    const loaded = outlines ? chunkCells(set.id, paged, paints) : [];
    const outlined = loaded.length > 0;
    const cells = outlined ? loaded : summaryCells(set.id, paged.summary);
    drawing.setChoices(
      outlined ? { draw: "outline", colorBy: "class" } : { draw: "dots", colorBy: "score" },
    );
    drawing.setObjects(cells);
    drawing.setCurrent(picked?.id ?? null);
    setDrawn({ cells: cells.length, as: outlined ? "outlines" : "dots" });
  }, [drawing, paged, version, outlines, set.id, paints, picked]);
  useEffect(() => {
    const stage = frame.current?.closest<HTMLElement>('[data-testid="slide-stage"]');
    if (paged === null || !outlines || !stage) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (start === null || event.button !== 0) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > clickSlopScreenPixels)
        return;
      if (stage.dataset.tool !== "select") return;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, [role="toolbar"], [data-testid="context-bar"]')
      )
        return;
      const at = slideAt(engine, stage, event);
      const reach = pickSlopScreenPixels / 2 ** engine.getCamera().zoom;
      setPicked(cellAt(set.id, paged, paints, at, reach));
    };
    stage.addEventListener("pointerdown", onDown, true);
    stage.addEventListener("pointerup", onUp, true);
    return () => {
      stage.removeEventListener("pointerdown", onDown, true);
      stage.removeEventListener("pointerup", onUp, true);
    };
  }, [engine, paged, outlines, paints, set.id, frame]);
  return (
    <>
      {picked === null ? null : (
        <PickedCellCard
          key={picked.id}
          set={set}
          cell={picked}
          retype={retype?.resultSetId === set.id ? retype : null}
        />
      )}
      <SetCellsMarker
        frame={frame}
        set={set}
        drawn={drawn}
        resident={paged?.cache.size ?? 0}
        picked={picked}
      />
    </>
  );
}

function PickedCellCard({
  set,
  cell,
  retype,
}: {
  set: ResultSet;
  cell: PickedCell;
  retype: CellRetype | null;
}) {
  const { t } = useLingui();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed === null ? cell : { ...cell, typeName: typed };
  const card = (
    <section className={dockedCard} data-testid="picked-cell" data-cell={cell.id}>
      <h3 className="truncate font-medium text-fg">
        <Trans>Cell {cell.number}</Trans>
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-fg-dim">
        <dt>
          <Trans>ID</Trans>
        </dt>
        <dd className="text-fg" data-testid="picked-cell-id">
          {cell.id}
        </dd>
        <dt>
          <Trans>Type</Trans>
        </dt>
        <dd className="text-fg" data-testid="picked-cell-type">
          {shown.typeName ?? t`No type`}
        </dd>
        <dt>
          <Trans>Score</Trans>
        </dt>
        <dd className="text-fg" data-testid="picked-cell-score">
          {cell.score.toFixed(2)}
        </dd>
        <dt>
          <Trans>Result set</Trans>
        </dt>
        <dd className="truncate text-fg">{set.name}</dd>
      </dl>
      {retype === null ? (
        <p className="text-fg-dim">
          <Trans>To change it, edit this cell in an annotate task.</Trans>
        </p>
      ) : (
        <RetypeAiCell retype={retype} cell={shown} onTyped={setTyped} />
      )}
    </section>
  );
  return (
    <>
      <DockCard section="objects" order={0}>
        {card}
      </DockCard>
      {useDocked() ? (
        <DockCard section="display" order={0}>
          {card}
        </DockCard>
      ) : null}
    </>
  );
}

function SetCellsMarker({
  frame,
  set,
  drawn,
  resident,
  picked,
}: {
  frame: RefObject<HTMLDivElement | null>;
  set: ResultSet;
  drawn: { cells: number; as: string };
  resident: number;
  picked: PickedCell | null;
}) {
  return (
    <div
      ref={frame}
      className="pointer-events-none invisible absolute inset-0"
      data-picked={picked?.id ?? ""}
      data-testid="result-set-cells"
      data-set={set.id}
      data-cells={drawn.cells}
      data-drawn={drawn.as}
      data-resident={resident}
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
  const { classPalette: palette } = useDisplayDefaults();
  const detail = okData(useGetResultSet(setId).data);
  const projectId = detail?.project_id ?? "";
  const projectClasses = okData(
    useListProjectClasses(projectId, { query: { enabled: projectId !== "" } }).data,
  );
  return useMemo(
    () => classPaints(detail?.classes ?? [], projectClasses ?? [], palette),
    [detail, projectClasses, palette],
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
  retype = null,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
  inTask: boolean;
  shown: boolean;
  retype?: CellRetype | null;
}) {
  const paints = useSetPaints(set.id);
  if (!shown) return null;
  const taskSet = retype?.resultSetId === set.id;
  return (
    <>
      {(set.cell_count ?? 0) > 0 ? (
        <SetCells
          engine={engine}
          module={module}
          set={set}
          outlines={!inTask || taskSet}
          paints={paints}
          retype={retype}
        />
      ) : null}
      {!inTask && (set.region_count ?? 0) > 0 ? (
        <SetRegions engine={engine} module={module} set={set} paints={paints} />
      ) : null}
      {inTask ? null : <ClassLegend set={set} paints={paints} />}
    </>
  );
}

type SetsProps = {
  engine: ViewerEngine;
  module: ViewerModule;
  slideId: string;
  inTask?: boolean;
  retype?: CellRetype | null;
};

function SetToggles({
  sets,
  shown,
  locked,
  onToggle,
}: {
  sets: readonly ResultSet[];
  shown: (id: string) => boolean;
  locked?: string | undefined;
  onToggle: (id: string) => void;
}) {
  const { t } = useLingui();
  if (sets.length === 0) return null;
  return (
    <DockCard section="sets" order={1}>
      <section
        className="grid gap-1.5"
        aria-label={t`Result sets`}
        data-testid="result-set-toggles"
      >
        {sets.map((set) => {
          const on = shown(set.id);
          return (
            <label
              key={set.id}
              data-testid="result-set-toggle"
              data-shown={on || undefined}
              title={locked ?? set.name}
              className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md bg-surf-panel py-1.5 pr-3.5 pl-2 text-caption text-fg has-disabled:cursor-not-allowed has-disabled:text-fg-dim"
            >
              <span className="min-w-0 truncate">{set.name}</span>
              <Switch
                size="sm"
                checked={on}
                disabled={locked !== undefined}
                aria-label={t`Show ${set.name}`}
                onCheckedChange={() => onToggle(set.id)}
              />
            </label>
          );
        })}
        {locked === undefined ? null : (
          <small className="text-caption text-fg-dim" data-testid="result-sets-locked">
            {locked}
          </small>
        )}
      </section>
    </DockCard>
  );
}

function drawableSets(sets: readonly ResultSet[], inTask: boolean) {
  return sets.filter(
    (set) =>
      set.status === "ready" && ((set.cell_count ?? 0) > 0 || (!inTask && set.region_count > 0)),
  );
}

function SlideResultSets({ engine, module, slideId, inTask = false, retype = null }: SetsProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const drawable = drawableSets(okData(useListSlideResultSets(slideId).data) ?? [], inTask);
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
          retype={retype}
        />
      ))}
      <SetToggles sets={drawable} shown={(id) => !hidden.has(id)} onToggle={toggle} />
    </>
  );
}

function ReviewResultSets({ engine, module, slideId, taskId }: SetsProps & { taskId: string }) {
  const myDisplay = okData(useGetMyDisplay(taskId).data);
  const task = okData(useGetReviewTask(taskId).data);
  const display = useMemo(
    () => (myDisplay ? taskDisplayView(myDisplay, task?.code ?? "") : undefined),
    [myDisplay, task?.code],
  );
  const choice = useDisplayChoice({ taskId, display, myDisplay });
  const taskSetId = task?.slides.find((item) => item.slide_id === slideId)?.result_set_id;
  const others = drawableSets(okData(useListSlideResultSets(slideId).data) ?? [], false).filter(
    (set) => set.id !== taskSetId,
  );
  const lock = myDisplay?.task.locks?.["other-sets"];
  const locked =
    lock === undefined || lock === null
      ? undefined
      : `Locked by ${task?.code ?? "the task"}: ${lock.charAt(0).toLowerCase()}${lock.slice(1)}`;
  const kept = shownSetsOf(myDisplay?.settings);
  const shown = (id: string) => locked === undefined && (kept[id] ?? false);
  return (
    <>
      {others.map((set) => (
        <ResultSetLayer
          key={set.id}
          engine={engine}
          module={module}
          set={set}
          inTask={false}
          shown={shown(set.id)}
        />
      ))}
      <SetToggles
        sets={others}
        shown={shown}
        locked={locked}
        onToggle={(id) => choice.showSet(id, !shown(id))}
      />
    </>
  );
}

export function StageResultCells({
  reviewTaskId,
  ...props
}: SetsProps & { reviewTaskId?: string | undefined }) {
  return reviewTaskId === undefined ? (
    <SlideResultSets {...props} />
  ) : (
    <ReviewResultSets {...props} taskId={reviewTaskId} />
  );
}
