import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMe, useGetProject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useCallback } from "react";
import type { AnnotateTask } from "../annotations/annotate-task.ts";
import { okData } from "../screens/placeholder.tsx";
import { DockCard, useDocked } from "./inspector-slots.tsx";
import { canRunModels, canTuneRun, type ViewRect, viewScopeOf } from "./run-options.ts";
import { RunTilesMap } from "./run-tiles-map.tsx";
import { StartRunPanel } from "./start-run-panel.tsx";
import { type RunStreamControls, runStreamVisible, useRunStream } from "./use-run-stream.ts";
import { type TaskRunJoin, useTaskRunJoin } from "./use-task-run-join.ts";
import { type ViewerEngine, viewArea } from "./viewer-engine.ts";

type RunStreamLayerProps = {
  readonly engine: ViewerEngine;
  readonly stage: HTMLElement | null;
  readonly selection: ViewRect | null;
  readonly task: AnnotateTask | null;
  readonly projectId: string | undefined;
  readonly slideId: string;
  readonly startShown: boolean;
};

const secondsPerMinute = 60;
const msPerSecond = 1000;

function Remaining({ ms }: { ms: number | null }) {
  if (ms === null || ms <= 0) return null;
  const minutes = Math.ceil(ms / msPerSecond / secondsPerMinute);
  return (
    <span data-testid="run-stream-remaining">
      <Trans>about {minutes} min left</Trans>
    </span>
  );
}

function Status({ controls }: { controls: RunStreamControls }) {
  const { phase, progress, drawn } = controls;
  if (phase === "failed") return <Trans>The run could not stream onto this slide</Trans>;
  if (progress === null) return <Trans>Waiting for the first tile</Trans>;
  const done = progress.done;
  const total = progress.total ?? done;
  if (progress.status === "cancelled") {
    return (
      <Trans>
        Cancelled. Kept {drawn} objects from {done} finished tiles
      </Trans>
    );
  }
  if (progress.status === "cancelling" || progress.cancelRequested) {
    return <Trans>Cancelling, keeping the finished tiles</Trans>;
  }
  return (
    <>
      <Trans>
        {done} of {total} tiles, {drawn} objects
      </Trans>{" "}
      <Remaining ms={progress.remainingMs} />
    </>
  );
}

function RunStreamPanel({
  controls,
  slide,
}: {
  controls: RunStreamControls;
  slide: { readonly width: number; readonly height: number } | null;
}) {
  const { t } = useLingui();
  const docked = useDocked();
  const cancelling = controls.progress?.cancelRequested === true;
  return (
    <section
      aria-label={t`Whole-slide run`}
      data-testid="run-stream"
      data-phase={controls.phase}
      data-status={controls.progress?.status ?? "queued"}
      data-drawn={controls.drawn}
      data-done={controls.progress?.done ?? 0}
      className={
        docked
          ? "flex items-center gap-2 rounded-ctl border border-line bg-surf-panel px-3 py-2 text-caption"
          : "pointer-events-auto absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
      }
    >
      <RunTilesMap tiles={controls.tiles} slide={slide} />
      <span role="status" data-testid="run-stream-status">
        <Status controls={controls} />
      </span>
      {controls.phase === "streaming" ? (
        <Button
          size="sm"
          data-testid="run-stream-cancel"
          disabled={cancelling}
          onClick={controls.cancel}
        >
          <Trans>Cancel run</Trans>
        </Button>
      ) : null}
    </section>
  );
}

function ProjectRunStreamLayer(props: RunStreamLayerProps & { readonly projectId: string }) {
  const { engine, stage, projectId, slideId, selection, task, startShown } = props;
  const me = okData(useGetMe().data);
  const project = okData(useGetProject(projectId).data);
  const canTune = canTuneRun({
    tenantRole: me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.role,
    projectRole: project?.my_role,
  });
  const runner = canRunModels({
    tenantRole: me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.role,
    projectRole: project?.my_role,
  });
  const controls = useRunStream({ engine, projectId, slideId });
  const join = useTaskRunJoin({ projectId, task, onJoined: controls.release });
  const currentView = useCallback((): ViewRect | null => {
    const slide = engine.getSlide();
    if (slide === null || stage === null) return null;
    const { width, height } = stage.getBoundingClientRect();
    return viewScopeOf(viewArea(engine.getCamera(), { width, height }), slide);
  }, [engine, stage]);
  return (
    <DockCard section="objects" order={1}>
      {runStreamVisible(controls) ? (
        <RunStreamPanel controls={controls} slide={engine.getSlide()} />
      ) : null}
      {task === null ? null : <TaskRunStatus join={join} streamed={controls.drawn} />}
      {controls.phase === "streaming" || !runner || !startShown ? null : (
        <StartRunPanel
          projectId={projectId}
          slideId={slideId}
          currentView={currentView}
          selection={selection}
          canTune={canTune}
          taskId={task?.taskId ?? null}
          onStarted={(runIds) => {
            const [first] = runIds;
            if (task !== null && first !== undefined) join.watch(first);
            void controls.watchNow();
          }}
          onLoadLast={controls.loadLast}
        />
      )}
    </DockCard>
  );
}

function TaskRunLine({ join }: { join: TaskRunJoin }) {
  const status = join.status ?? "";
  const code = join.code;
  if (join.phase === "running") return <Trans>The run is streaming onto the slide</Trans>;
  if (join.phase === "joining") return <Trans>Adding the run to the task</Trans>;
  if (join.phase === "joined") return <Trans>Its objects are AI objects of this task now</Trans>;
  if (join.phase === "scoped") return <Trans>The run joined the task's check scope</Trans>;
  if (join.phase === "ended") return <Trans>The run ended as {status}, nothing was added</Trans>;
  if (join.phase === "failed") return <Trans>The server refused it ({code})</Trans>;
  return null;
}

function TaskRunStatus({ join, streamed }: { join: TaskRunJoin; streamed: number }) {
  const docked = useDocked();
  return (
    <p
      role="status"
      data-testid="annotate-run"
      data-phase={join.phase}
      data-run={join.runId ?? ""}
      data-streamed={streamed}
      className={
        docked
          ? "m-0 text-caption text-fg-dim empty:hidden"
          : "pointer-events-none absolute bottom-28 left-3 z-10 m-0 rounded-md bg-chrome px-2 py-1 text-caption text-fg-dim empty:hidden"
      }
    >
      <TaskRunLine join={join} />
    </p>
  );
}

export function RunStreamLayer(props: RunStreamLayerProps) {
  if (props.projectId === undefined) return null;
  return <ProjectRunStreamLayer {...props} projectId={props.projectId} />;
}
