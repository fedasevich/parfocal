import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  getGetReviewTaskQueryKey,
  type LayerObject,
  type ProjectClass,
  type SharedLayer,
  useGetMe,
  useGetReviewOrder,
  useListSlideResultSets,
} from "@parfocal/api-client";
import {
  AiResultToggle,
  CheckedCard,
  CheckProgress,
  CheckStateTag,
  OriginMark,
  SignOffCard,
} from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Loader } from "@parfocal/ui/components/loader";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AiEditBridge,
  type AiEntry,
  type AiState,
  cellsInExtent,
  cellsOf,
  changeOf,
  chipsOf,
  emptyAiHistory,
  idleAiBridge,
  maxBatchCells,
  narrow,
  originalOf,
  type PickMode,
  pick,
  type Ring,
  readingOrder,
  recordAi,
  redoAi,
  retypedLine,
  sameState,
  stateOf,
  stepFrom,
  tagOf,
  undoAi,
} from "../annotations/ai-edit.ts";
import { AiLayer } from "../annotations/ai-layer.tsx";
import {
  type AnnotateTask,
  aiCheckCounts,
  aiResultViewOf,
  aiWithChecks,
  canSignOff,
  classCountsOf,
  nextSlideOf,
  originMarkOf,
  runsToAddOf,
  slideStepOf,
  taskProgressOf,
} from "../annotations/annotate-task.ts";
import {
  addRun,
  changeAiBatch,
  checkSlide,
  confirmAi,
  sharedLayerKey,
  signOffSlide,
  slideStatusKey,
  slideStatusQuery,
  uncheckSlide,
  useSharedAiObjects,
  useSharedLayer,
} from "../annotations/annotate-task-api.ts";
import { confirmAction, confirmActions, confirms } from "../annotations/check-state.ts";
import { useClassKeys } from "../annotations/class-keys.ts";
import {
  guideAction,
  guidedAvailable,
  guidedToggle,
  guides,
  nextClassOf,
  selectionAfterRowClick,
} from "../annotations/guided-check.ts";
import { interruptMotion } from "../annotations/stage-pointer.ts";

import type { SaveState } from "../annotations/use-saved-annotations.ts";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { ReasonModal } from "../screens/clinical-report/modals.tsx";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { GuidedCheck } from "./guided-check.tsx";
import { DockCard, dockedCard, useDocked } from "./inspector-slots.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";
import { screenToSlide } from "./viewer-engine.ts";

const guideActionList = [guideAction];

const quietBeforeRefreshMs = 400;

type AnnotateTaskPanelProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  task: AnnotateTask;
  classes: readonly ProjectClass[];
  saveState: SaveState;
  colourOf: (classKey: string | null) => string;
  selecting?: boolean;
  bridge?: RefObject<AiEditBridge>;
  onOpenSlide?: ((slideId: string) => void) | undefined;
};

const noSelection: readonly string[] = [];
const noPending: ReadonlyMap<string, AiState> = new Map();

const problemCode = (error: unknown) =>
  error instanceof ApiError ? (error.problem?.code ?? `${error.status}`) : "network";

const refusals: Record<string, string> = {
  "layer-not-empty": "The slide has objects, so it is not empty.",
  "slide-signed-off": "This slide is signed off and its layer is locked.",
  "reason-needed": "Give a reason to change a signed-off slide.",
  "no-result-set": "Add only a finished result set of the same slide.",
  "experts-unchecked": "Every assigned expert has to check the slide first.",
  "objects-unchecked": "The task needs every AI object checked before sign-off.",
  "annotation-changed":
    "A colleague changed some of these cells, so nothing was changed. Look at them and try again.",
};

export function AnnotateTaskPanel({
  engine,
  stage,
  task,
  classes,
  saveState,
  colourOf,
  selecting = false,
  bridge,
  onOpenSlide,
}: AnnotateTaskPanelProps) {
  const { t } = useLingui();
  const docked = useDocked();
  const { taskId, slideId } = task;
  const queryClient = useQueryClient();
  const me = okData(useGetMe().data)?.user_id ?? null;
  const personOf = usePeople();
  const layerQuery = useSharedLayer(taskId, slideId);
  const layer = okData(layerQuery.data)?.objects ?? [];
  const aiQuery = useSharedAiObjects(taskId, slideId, task.resultSetId !== null);
  const aiList = okData(aiQuery.data);
  const loaded = layerQuery.isSuccess && (task.resultSetId === null || aiQuery.isSuccess);
  const statusQueries = useQueries({
    queries: task.slideIds.map((id) => slideStatusQuery(taskId, id)),
  });
  const statuses = statusQueries.map((query) => okData(query.data));
  const status = statuses[task.slideIds.indexOf(slideId)];
  const [aiHidden, setAiHidden] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>(noSelection);
  const selected = selection.length === 1 ? (selection[0] ?? null) : null;
  const setSelected = useCallback(
    (next: string | null | ((now: string | null) => string | null)) =>
      setSelection((now) => {
        const one = now.length === 1 ? (now[0] ?? null) : null;
        const picked = typeof next === "function" ? next(one) : next;
        return picked === null ? noSelection : [picked];
      }),
    [],
  );
  const [pending, setPending] = useState(noPending);
  const [aiHistory, setAiHistory] = useState(emptyAiHistory);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [guided, setGuided] = useState(false);
  const [addingRun, setAddingRun] = useState<string | null>(null);

  const refetchLayer = layerQuery.refetch;
  const lastSave = useRef(saveState);
  useEffect(() => {
    if (lastSave.current !== saveState && saveState === "saved") void refetchLayer();
    lastSave.current = saveState;
  }, [saveState, refetchLayer]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sharedLayerKey(taskId, slideId) }),
      queryClient.invalidateQueries({ queryKey: getGetReviewTaskQueryKey(taskId) }),
      ...task.slideIds.map((id) =>
        queryClient.invalidateQueries({
          queryKey: slideStatusKey(taskId, id),
        }),
      ),
    ]);
  }, [queryClient, taskId, slideId, task.slideIds]);

  const keepSaved = useCallback(
    (saved: readonly LayerObject[]) =>
      queryClient.setQueryData<{ data: SharedLayer }>(sharedLayerKey(taskId, slideId), (old) => {
        if (old === undefined) return old;
        const fresh = new Map(saved.map((item) => [item.id, item]));
        const kept = old.data.objects.map((item) => fresh.get(item.id) ?? item);
        const known = new Set(kept.map((item) => item.id));
        const added = saved.filter((item) => !known.has(item.id));
        return { ...old, data: { ...old.data, objects: [...kept, ...added] } };
      }),
    [queryClient, taskId, slideId],
  );

  const working = useRef(false);
  const refreshTimer = useRef<number | undefined>(undefined);
  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      lock: "until-refreshed" | "until-saved" = "until-refreshed",
    ) => {
      if (working.current) return;
      working.current = true;
      setRefusal(null);
      try {
        await action();
      } catch (error) {
        const code = problemCode(error);
        setRefusal(refusals[code] ?? `The server refused it (${code}).`);
      }
      if (lock === "until-saved") {
        working.current = false;
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void refresh(), quietBeforeRefreshMs);
        return;
      }
      try {
        await refresh();
      } finally {
        working.current = false;
      }
    },
    [refresh],
  );

  const setsQuery = useListSlideResultSets(slideId);
  const newRuns = runsToAddOf(okData(setsQuery.data) ?? [], task);
  const addingSet = newRuns.find((set) => set.id === addingRun);

  const orderQuery = useGetReviewOrder(
    taskId,
    slideId,
    { limit: 1000 },
    { query: { enabled: guided && task.resultSetId !== null } },
  );
  const stored = okData(orderQuery.data);
  const storedOrder =
    stored === undefined || stored.objects.length === 0
      ? null
      : stored.objects.map((item) => item.object);
  const view = aiResultViewOf(task.resultSetId, aiList?.result_name ?? null, aiHidden);
  const ai = aiWithChecks(aiList?.objects ?? [], layer);
  const shownAi = view.shown ? ai : [];
  const drawn = layer.filter((item) => item.source === null && item.deleted_at === null);
  const selectedAi = shownAi.find((object) => object.object === selected);
  const cells = useMemo(() => cellsOf(shownAi, pending), [shownAi, pending]);
  const step = slideStepOf(status, me);
  const locked = step === "signed-off";
  const counts = aiCheckCounts(ai);
  const classCounts = classCountsOf(classes, [
    ...drawn,
    ...shownAi
      .filter((object) => object.check !== "deleted")
      .map((object) => ({ class_id: object.copy?.class_id ?? object.class_id })),
  ]);
  const progress = taskProgressOf(statuses, me);
  const nothingToMark = loaded && drawn.length === 0 && ai.length === 0;

  const confirmSelected = useCallback(() => {
    if (selectedAi === undefined || selectedAi.check !== "unchecked" || locked) return;
    if (guided) interruptMotion(engine);
    void run(async () => {
      const answer = await confirmAi(taskId, slideId, selectedAi.object, {
        geometry: selectedAi.geometry,
      });
      void queryClient.cancelQueries({ queryKey: sharedLayerKey(taskId, slideId) });
      keepSaved([answer.data]);
    }, "until-saved");
  }, [selectedAi, locked, guided, engine, run, taskId, slideId, keepSaved, queryClient]);
  const latestConfirm = useRef(confirmSelected);
  latestConfirm.current = confirmSelected;
  const confirmBindings = useBindings(["annotate"], confirmActions);
  const onConfirmKey = useCallback((fired: Fired) => {
    if (confirms(fired)) latestConfirm.current();
  }, []);
  useHotkeys(confirmBindings, onConfirmKey);

  const latestCanGuide = useRef(false);
  latestCanGuide.current = guidedAvailable(view.shown, ai.length, locked);
  const guideBindings = useBindings(["annotate"], guideActionList);
  const toggleGuide = useCallback(
    () => setGuided((on) => guidedToggle(on, latestCanGuide.current)),
    [],
  );
  const onGuideKey = useCallback(
    (fired: Fired) => {
      if (guides(fired)) toggleGuide();
    },
    [toggleGuide],
  );
  useHotkeys(guideBindings, onGuideKey);

  const versions = useRef(new Map<string, number>());
  for (const cell of cells) {
    const known = versions.current.get(cell.object) ?? 0;
    if (cell.version !== null && cell.version > known) {
      versions.current.set(cell.object, cell.version);
    }
  }
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const aiStamp = useRef(0);
  const live = useRef({ cells, selection, aiHistory, locked });
  live.current = { cells, selection, aiHistory, locked };

  const send = useCallback(
    (states: readonly AiState[]) => {
      setRefusal(null);
      setPending((now) => {
        const next = new Map(now);
        for (const state of states) next.set(state.object, state);
        return next;
      });
      const settle = () =>
        setPending((now) => {
          const next = new Map(now);
          for (const state of states) {
            if (next.get(state.object) === state) next.delete(state.object);
          }
          return next;
        });
      const work = sending.current.then(async () => {
        try {
          const answer = await changeAiBatch(
            taskId,
            slideId,
            states.map((state) => changeOf(state, versions.current.get(state.object) ?? null)),
          );
          const saved = answer.data.objects;
          for (const item of saved) {
            if (item.source !== null) versions.current.set(item.source, item.version);
          }
          keepSaved(saved);
          settle();
          return true;
        } catch (error) {
          const code = problemCode(error);
          setRefusal(refusals[code] ?? `The server refused it (${code}).`);
          setNotice(null);
          settle();
          versions.current.clear();
          await refresh();
          return false;
        }
      });
      sending.current = work;
      return work;
    },
    [taskId, slideId, keepSaved, refresh],
  );

  const edit = useCallback(
    (after: readonly AiState[], label: string, line?: (count: number) => string) => {
      const now = live.current;
      if (now.locked) {
        setRefusal(refusals["slide-signed-off"] ?? null);
        return;
      }
      const byId = new Map(now.cells.map((cell) => [cell.object, cell]));
      const changed = after.filter((state) => {
        const cell = byId.get(state.object);
        return cell !== undefined && !sameState(cell, state);
      });
      if (changed.length === 0) return;
      const before = changed.flatMap((state) => {
        const cell = byId.get(state.object);
        return cell === undefined ? [] : [stateOf(cell)];
      });
      const entry: AiEntry = { label, before, after: changed };
      setAiHistory((history) => recordAi(history, entry));
      aiStamp.current = Date.now();
      setNotice(line === undefined ? null : line(changed.length));
      void send(changed);
    },
    [send],
  );

  const selectedCells = useCallback(() => {
    const chosen = new Set(live.current.selection);
    return live.current.cells.filter((cell) => chosen.has(cell.object));
  }, []);

  const retype = useCallback(
    (classId: string) => {
      const target = classes.find((item) => item.id === classId);
      const picked = selectedCells().filter((cell) => !cell.deleted);
      if (target === undefined || picked.length === 0) return;
      edit(
        picked.map((cell) => ({ ...stateOf(cell), classId })),
        "Retype",
        (count) => retypedLine(count, target.name),
      );
    },
    [classes, edit, selectedCells],
  );
  const retypeSlot = useCallback(
    (slot: number) => {
      const picked = classes[slot - 1];
      if (picked !== undefined) retype(picked.id);
    },
    [classes, retype],
  );
  useClassKeys(retypeSlot, selecting && selection.length > 0 && !guided);

  const deleteSelection = useCallback(() => {
    const picked = selectedCells().filter((cell) => !cell.deleted);
    if (picked.length === 0) return;
    edit(
      picked.map((cell) => ({ ...stateOf(cell), deleted: true })),
      "Delete",
      (count) => (count === 1 ? "1 cell deleted" : `${count} cells deleted`),
    );
    if (!live.current.locked) setSelection(noSelection);
  }, [edit, selectedCells]);

  const reshape = useCallback(
    (object: string, ring: Ring) => {
      const cell = live.current.cells.find((item) => item.object === object);
      if (cell !== undefined) edit([{ ...stateOf(cell), ring }], "Reshape");
    },
    [edit],
  );

  const restoreSelection = useCallback(() => {
    const picked = selectedCells().filter((cell) => cell.edited);
    edit(picked.map(originalOf), "Restore the AI original", () => "The AI original is back");
  }, [edit, selectedCells]);

  const pickCells = useCallback((ids: readonly string[], mode: PickMode) => {
    setNotice(null);
    setSelection((now) => {
      const next = pick(now, ids, mode);
      return next.length === 0 ? noSelection : next;
    });
  }, []);

  const order = useMemo(() => readingOrder(cells), [cells]);
  const stepCell = useCallback(
    (delta: 1 | -1) => {
      const now = live.current.selection;
      const next = stepFrom(order, now.length === 1 ? (now[0] ?? null) : null, delta);
      if (next === null) return;
      setSelection([next]);
      const cell = live.current.cells.find((item) => item.object === next);
      if (cell === undefined) return;
      const bounds = stage.getBoundingClientRect();
      const camera = engine.getCamera();
      const corner = screenToSlide(camera, bounds, bounds.left, bounds.top);
      const far = screenToSlide(camera, bounds, bounds.right, bounds.bottom);
      const inView =
        cell.centre.x > corner.x &&
        cell.centre.x < far.x &&
        cell.centre.y > corner.y &&
        cell.centre.y < far.y;
      if (inView) return;
      const width = far.x - corner.x;
      const height = far.y - corner.y;
      void engine.flyToArea({
        x: cell.centre.x - width / 2,
        y: cell.centre.y - height / 2,
        width,
        height,
      });
    },
    [order, engine, stage],
  );

  const replay = useCallback(
    (states: readonly AiState[], label: string) => {
      aiStamp.current = Date.now();
      setNotice(label);
      void send(states);
    },
    [send],
  );
  const undoAiEdit = useCallback(() => {
    const done = undoAi(live.current.aiHistory);
    if (done === null || live.current.locked) return false;
    setAiHistory(done.history);
    replay(done.entry.before, `Undid ${done.entry.label.toLowerCase()}`);
    return true;
  }, [replay]);
  const redoAiEdit = useCallback(() => {
    const done = redoAi(live.current.aiHistory);
    if (done === null || live.current.locked) return false;
    setAiHistory(done.history);
    replay(done.entry.after, `Redid ${done.entry.label.toLowerCase()}`);
    return true;
  }, [replay]);

  const aiShown = view.shown;
  useEffect(() => {
    if (bridge === undefined) return;
    bridge.current = {
      marquee: (area, additive) => {
        if (!aiShown) return;
        pickCells(cellsInExtent(live.current.cells, area), additive ? "add" : "replace");
      },
      undo: undoAiEdit,
      redo: redoAiEdit,
      stamp: () => aiStamp.current,
    };
    return () => {
      bridge.current = { ...idleAiBridge };
    };
  }, [bridge, aiShown, pickCells, undoAiEdit, redoAiEdit]);

  const chips = chipsOf(cells, selection, classes);
  const nameOfClass = (classId: string | null) =>
    classes.find((item) => item.id === classId)?.name ?? "No type";
  const soleCell = selected === null ? undefined : cells.find((cell) => cell.object === selected);
  const soleTag =
    soleCell === undefined
      ? null
      : tagOf(
          soleCell,
          nameOfClass,
          selectedAi?.copy === undefined
            ? null
            : (personOf(originMarkOf(selectedAi.copy).authorId)?.initials ?? null),
        );
  const checkOf = (object: string) => {
    const waiting = pending.get(object);
    if (waiting !== undefined) return waiting.deleted ? "deleted" : "edited";
    return ai.find((item) => item.object === object)?.check ?? "unchecked";
  };

  const reclassSelected = () => {
    if (soleCell === undefined) return;
    const classId = nextClassOf(
      classes.map((item) => item.id),
      soleCell.classId,
    );
    if (classId !== null) retype(classId);
  };

  const deleteSelected = deleteSelection;
  const guidedObjectWaits = () => !working.current && selectedAi?.check === "unchecked";

  const addRunNow = (resultSetId: string, reason?: string) =>
    void run(() => addRun(taskId, slideId, resultSetId, reason));

  const next = onOpenSlide === undefined ? null : nextSlideOf(task.slideIds, slideId, statuses, me);
  const summary = nothingToMark
    ? "You marked this slide as having nothing to mark. Colleagues see it as checked."
    : `${counts.confirmed + counts.edited + counts.deleted} of ${counts.total} AI objects checked. The layer has ${drawn.length} drawn by hand.`;

  return (
    <>
      {view.shown ? (
        <AiLayer
          engine={engine}
          stage={stage}
          cells={cells}
          checkOf={checkOf}
          selection={selection}
          selecting={selecting && !guided}
          locked={locked}
          tag={soleTag}
          colourOf={colourOf}
          onPick={pickCells}
          onReshape={reshape}
          onDelete={deleteSelection}
          onStep={stepCell}
        />
      ) : null}
      <DockCard section="objects" order={0}>
        <section
          aria-label={t`Annotate task`}
          data-testid="annotate-task-panel"
          data-step={step}
          data-ai={view.shown ? "shown" : view.available ? "hidden" : "none"}
          className={
            docked
              ? dockedCard
              : "absolute top-4 left-16 grid max-h-[calc(100%-48px)] w-80 gap-2 overflow-auto rounded-ctl border border-line bg-chrome p-3"
          }
        >
          <p className="m-0 text-body-sm text-fg-dim" data-testid="task-progress">
            {progress.line}
          </p>
          {view.available ? (
            <AiResultToggle
              checked={view.shown}
              onCheckedChange={(on) => setAiHidden(!on)}
              resultName={aiList?.result_name ?? t`AI result`}
              count={ai.length}
            />
          ) : (
            <p className="m-0 text-body-sm text-fg-dim" data-testid="no-result-set">
              <Trans>{view.label}. Draw the objects by hand.</Trans>
            </p>
          )}
          {view.available && ai.length > 0 ? (
            <CheckProgress counts={counts} scope="AI objects" />
          ) : null}
          <ul
            aria-label={t`Counts per class`}
            className="m-0 grid list-none gap-1 p-0 text-body-sm"
          >
            {classCounts.map((item) => (
              <li key={item.id} className="flex items-center gap-2" data-testid="class-count">
                <i
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: colourOf(item.id) }}
                />
                {item.name}
                <span className="ml-auto font-mono text-fg-dim">{item.count}</span>
              </li>
            ))}
          </ul>
          <ul
            aria-label={t`Objects`}
            className="m-0 grid max-h-64 list-none gap-0.5 overflow-auto p-0"
          >
            {shownAi.map((object) => (
              <li key={object.object}>
                <button
                  type="button"
                  aria-pressed={object.object === selected}
                  data-testid="task-object"
                  data-origin={object.origin}
                  onClick={() =>
                    setSelected((now) => selectionAfterRowClick(guided, now, object.object))
                  }
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-body-sm text-fg hover:bg-chrome-3 aria-pressed:bg-accent-soft"
                >
                  <span className="w-9 shrink-0 font-mono">{object.object}</span>
                  <OriginMark
                    origin={object.origin}
                    author={
                      object.copy === undefined
                        ? undefined
                        : personOf(originMarkOf(object.copy).authorId)
                    }
                  />
                  <CheckStateTag state={object.check} className="ml-auto" />
                </button>
              </li>
            ))}
            {drawn.map((object) => (
              <li
                key={object.id}
                data-testid="task-object"
                data-origin={object.origin}
                className="flex items-center gap-2 px-1.5 py-1 text-body-sm"
              >
                <span className="w-9 shrink-0 font-mono">{object.code}</span>
                <OriginMark origin="human" author={personOf(originMarkOf(object).authorId)} />
              </li>
            ))}
          </ul>
          {guidedAvailable(view.shown, ai.length, locked) ? (
            guided ? (
              orderQuery.isPending ? (
                <div data-testid="guided-loading">
                  <Loader label={t`Loading the check order`} />
                </div>
              ) : (
                <GuidedCheck
                  engine={engine}
                  objects={ai}
                  storedOrder={storedOrder}
                  locked={locked}
                  canReclass={classes.length > 1}
                  onCurrent={setSelected}
                  onConfirm={confirmSelected}
                  onDelete={() => {
                    if (guidedObjectWaits()) deleteSelected();
                  }}
                  onReclass={() => {
                    if (guidedObjectWaits()) reclassSelected();
                  }}
                  onLeave={toggleGuide}
                />
              )
            ) : (
              <Button size="sm" onClick={toggleGuide}>
                <Trans>Guided check</Trans> <Keycap action={guideAction} keys="⇧G" size="sm" />
              </Button>
            )
          ) : null}
          {selection.length > 0 ? (
            <fieldset
              aria-label={t`Selected cells`}
              data-testid="ai-selection"
              data-count={selection.length}
              className="m-0 grid min-w-0 gap-1.5 rounded-md border border-line p-2 text-body-sm"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <button
                    key={chip.classId ?? "none"}
                    type="button"
                    data-testid="type-chip"
                    title={t`Click keeps only this type. Shift and click drops it.`}
                    onClick={(event) =>
                      setSelection(narrow(cells, selection, chip.classId, !event.shiftKey, classes))
                    }
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-ctl border border-line bg-chrome px-2 py-0.5 font-mono text-caption text-fg hover:bg-chrome-3"
                  >
                    <i
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: colourOf(chip.classId) }}
                    />
                    {chip.name} {chip.count}
                  </button>
                ))}
              </div>
              <p className="m-0 text-fg-dim" data-testid="ai-selection-hint">
                {locked
                  ? t`This slide is signed off and its layer is locked.`
                  : selection.length >= maxBatchCells
                    ? t`One change takes at most 5,000 cells. Keys 1 to 9 retype them, X deletes them.`
                    : t`Keys 1 to 9 retype the selection, X deletes it, J goes to the next cell.`}
              </p>
              {!locked && selectedCells().some((cell) => cell.edited) ? (
                <Button size="sm" data-testid="ai-restore" onClick={restoreSelection}>
                  <Trans>Restore the AI original</Trans>
                </Button>
              ) : null}
            </fieldset>
          ) : null}
          {notice ? (
            <p
              role="status"
              data-testid="ai-notice"
              className="m-0 flex items-center gap-2 text-body-sm"
            >
              {notice}
              {aiHistory.cursor > 0 && !locked ? (
                <Button size="sm" onClick={undoAiEdit}>
                  <Trans>Undo</Trans>
                </Button>
              ) : null}
            </p>
          ) : null}
          {selectedAi && !locked ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={selectedAi.check !== "unchecked"}
                onClick={confirmSelected}
              >
                <Trans>Confirm {selectedAi.object}</Trans>{" "}
                <Keycap action={confirmAction} keys="D" size="sm" />
              </Button>
              <Button size="sm" disabled={selectedAi.check === "deleted"} onClick={deleteSelected}>
                <Trans>Delete {selectedAi.object}</Trans>
              </Button>
            </div>
          ) : null}
          {newRuns.length > 0 && (!locked || task.owner) ? (
            <ul aria-label={t`Runs to add`} className="m-0 grid list-none gap-1 p-0">
              {newRuns.map((set) => (
                <li key={set.id}>
                  <Button
                    size="sm"
                    data-testid="add-run"
                    onClick={() => (locked ? setAddingRun(set.id) : addRunNow(set.id))}
                  >
                    <Trans>Add the run {set.name}</Trans>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {addingSet ? (
            <ReasonModal
              title={t`Add a run to a signed-off slide`}
              subtitle={t`This slide is signed off`}
              whatLabel={t`What changes`}
              what={t`The run ${addingSet.name} joins this slide`}
              label={t`Reason`}
              placeholder={t`For example, a newer model run finished`}
              help={t`The reason goes into the history of the layer.`}
              hint={t`The change is listed with the evaluation.`}
              primary={t`Add the run`}
              tooShort={t`Give a reason of at least 10 characters.`}
              onClose={() => setAddingRun(null)}
              onSubmit={(reason) => {
                setAddingRun(null);
                addRunNow(addingSet.id, reason);
              }}
            />
          ) : null}
          {aiQuery.isError ? (
            <p role="alert" className="m-0 text-body-sm text-danger">
              <Trans>The AI result did not load. Reload the slide to try again.</Trans>
            </p>
          ) : null}
          {refusal ? (
            <p role="alert" className="m-0 text-body-sm text-danger">
              {refusal}
            </p>
          ) : null}
          {step === "open" ? (
            <Button
              variant="primary"
              disabled={!loaded}
              onClick={() =>
                void run(() =>
                  checkSlide(taskId, slideId, nothingToMark ? { nothing_to_mark: true } : {}),
                )
              }
            >
              {nothingToMark ? t`Nothing to mark` : t`Mark slide checked`}
            </Button>
          ) : null}
          {step !== "open" ? (
            <CheckedCard
              nothingToMark={
                status?.experts.find((expert) => expert.user_id === me)?.nothing_to_mark ?? false
              }
              summary={summary}
              {...(locked ? {} : { onUndo: () => void run(() => uncheckSlide(taskId, slideId)) })}
              {...(next === null || onOpenSlide === undefined
                ? {}
                : { onNext: () => onOpenSlide(next) })}
            />
          ) : null}
          {status && (canSignOff(status, task.owner) || locked) ? (
            <SignOffCard
              slideName="this slide"
              openThreads={status.open_threads}
              signedOff={locked}
              experts={status.experts.map((expert) => ({
                person: personOf(expert.user_id) ?? {
                  initials: "?",
                  name: "Expert",
                  color: "var(--fg-dim)",
                },
                checked: expert.checked_at !== null,
                sub: expert.nothing_to_mark ? "Nothing to mark" : "Checked",
              }))}
              onSignOff={() => void run(() => signOffSlide(taskId, slideId))}
            />
          ) : null}
        </section>
      </DockCard>
    </>
  );
}
