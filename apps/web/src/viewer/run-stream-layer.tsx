import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMe, useGetProject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useCallback } from "react";
import { okData } from "../screens/placeholder.tsx";
import { canTuneRun, type ViewRect, viewScopeOf } from "./run-options.ts";
import { RunTilesMap } from "./run-tiles-map.tsx";
import { StartRunPanel } from "./start-run-panel.tsx";
import { type RunStreamControls, runStreamVisible, useRunStream } from "./use-run-stream.ts";
import { type ViewerEngine, viewArea } from "./viewer-engine.ts";

type RunStreamLayerProps = {
  readonly engine: ViewerEngine;
  readonly stage: HTMLElement | null;
  readonly selection: ViewRect | null;
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
  const cancelling = controls.progress?.cancelRequested === true;
  return (
    <section
      aria-label={t`Whole-slide run`}
      data-testid="run-stream"
      data-phase={controls.phase}
      data-status={controls.progress?.status ?? "queued"}
      data-drawn={controls.drawn}
      data-done={controls.progress?.done ?? 0}
      className="pointer-events-auto absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
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
  const { engine, stage, projectId, slideId, selection, startShown } = props;
  const me = okData(useGetMe().data);
  const project = okData(useGetProject(projectId).data);
  const canTune = canTuneRun({
    tenantRole: me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.role,
    projectRole: project?.my_role,
  });
  const controls = useRunStream({ engine, projectId, slideId });
  const currentView = useCallback((): ViewRect | null => {
    const slide = engine.getSlide();
    if (slide === null || stage === null) return null;
    const { width, height } = stage.getBoundingClientRect();
    return viewScopeOf(viewArea(engine.getCamera(), { width, height }), slide);
  }, [engine, stage]);
  return (
    <>
      {runStreamVisible(controls) ? (
        <RunStreamPanel controls={controls} slide={engine.getSlide()} />
      ) : null}
      {controls.phase === "streaming" || !startShown ? null : (
        <StartRunPanel
          projectId={projectId}
          slideId={slideId}
          currentView={currentView}
          selection={selection}
          canTune={canTune}
          onStarted={() => void controls.watchNow()}
          onLoadLast={controls.loadLast}
        />
      )}
    </>
  );
}

export function RunStreamLayer(props: RunStreamLayerProps) {
  if (props.projectId === undefined) return null;
  return <ProjectRunStreamLayer {...props} projectId={props.projectId} />;
}
