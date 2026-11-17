import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  getGetReviewTaskQueryKey,
  type ProjectClass,
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
import { useCallback, useEffect, useRef, useState } from "react";
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
  changeAi,
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
import {
  guideAction,
  guidedAvailable,
  guidedToggle,
  guides,
  nextClassOf,
  selectionAfterRowClick,
} from "../annotations/guided-check.ts";

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

const guideActionList = [guideAction];

type AnnotateTaskPanelProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  task: AnnotateTask;
  classes: readonly ProjectClass[];
  saveState: SaveState;
  colourOf: (classKey: string | null) => string;
  onOpenSlide?: ((slideId: string) => void) | undefined;
};

const problemCode = (error: unknown) =>
  error instanceof ApiError ? (error.problem?.code ?? `${error.status}`) : "network";

const refusals: Record<string, string> = {
  "layer-not-empty": "The slide has objects, so it is not empty.",
  "slide-signed-off": "This slide is signed off and its layer is locked.",
  "reason-needed": "Give a reason to change a signed-off slide.",
  "no-result-set": "Add only a finished result set of the same slide.",
  "experts-unchecked": "Every assigned expert has to check the slide first.",
  "objects-unchecked": "The task needs every AI object checked before sign-off.",
};

export function AnnotateTaskPanel({
  engine,
  stage,
  task,
  classes,
  saveState,
  colourOf,
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
  const [selected, setSelected] = useState<string | null>(null);
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

  const working = useRef(false);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (working.current) return;
      working.current = true;
      setRefusal(null);
      try {
        await action();
      } catch (error) {
        const code = problemCode(error);
        setRefusal(refusals[code] ?? `The server refused it (${code}).`);
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
    void run(() =>
      confirmAi(taskId, slideId, selectedAi.object, { geometry: selectedAi.geometry }),
    );
  }, [selectedAi, locked, run, taskId, slideId]);
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

  const reclassSelected = () => {
    if (selectedAi === undefined || locked) return;
    const classId = nextClassOf(
      classes.map((item) => item.id),
      selectedAi.copy?.class_id ?? selectedAi.class_id,
    );
    if (classId === null) return;
    void run(() =>
      changeAi(taskId, slideId, selectedAi.object, {
        class_id: classId,
        geometry: selectedAi.geometry,
      }),
    );
  };

  const deleteSelected = () => {
    if (selectedAi === undefined || locked) return;
    void run(() =>
      changeAi(taskId, slideId, selectedAi.object, {
        deleted: true,
        geometry: selectedAi.geometry,
      }),
    );
  };

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
          objects={ai}
          selected={selected}
          colourOf={colourOf}
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
                  onDelete={deleteSelected}
                  onReclass={reclassSelected}
                  onLeave={toggleGuide}
                />
              )
            ) : (
              <Button size="sm" onClick={toggleGuide}>
                <Trans>Guided check</Trans> <Keycap action={guideAction} keys="⇧G" size="sm" />
              </Button>
            )
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
