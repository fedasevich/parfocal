import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { type RunStreamControls, useRunStream } from "./use-run-stream.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

type RunStreamLayerProps = {
  readonly engine: ViewerEngine;
  readonly projectId: string | undefined;
  readonly slideId: string;
  readonly taskId: string | null;
};

const secondsPerMinute = 60;
const msPerSecond = 1000;

function Remaining({ ms }: { ms: number | null }) {
  if (ms === null || ms <= 0) return null;
  const minutes = Math.ceil(ms / msPerSecond / secondsPerMinute);
  return (
    <span data-testid="run-stream-remaining">
      <Plural value={minutes} one="about # minute left" other="about # minutes left" />
    </span>
  );
}

function Status({ controls }: { controls: RunStreamControls }) {
  const { phase, progress, drawn } = controls;
  if (phase === "starting") return <Trans>Starting the run</Trans>;
  if (phase === "failed") return <Trans>The run could not stream onto this slide</Trans>;
  if (progress === null) return null;
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
  if (progress.status === "done") return <Trans>Done. {drawn} objects</Trans>;
  return (
    <>
      <Trans>
        {done} of {total} tiles, {drawn} objects
      </Trans>{" "}
      <Remaining ms={progress.remainingMs} />
    </>
  );
}

function RunStreamPanel({ controls }: { controls: RunStreamControls }) {
  const { t } = useLingui();
  const running = controls.phase === "starting" || controls.phase === "streaming";
  const cancelling = controls.progress?.cancelRequested === true;
  return (
    <section
      aria-label={t`Whole-slide run`}
      data-testid="run-stream"
      data-phase={controls.phase}
      data-status={controls.progress?.status ?? "idle"}
      data-drawn={controls.drawn}
      data-done={controls.progress?.done ?? 0}
      className="pointer-events-auto absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-xs shadow-sm"
    >
      <span role="status" data-testid="run-stream-status">
        <Status controls={controls} />
      </span>
      {running ? (
        <Button
          size="sm"
          data-testid="run-stream-cancel"
          disabled={cancelling || controls.phase === "starting"}
          onClick={controls.cancel}
        >
          <Trans>Cancel run</Trans>
        </Button>
      ) : (
        <Button size="sm" variant="primary" data-testid="run-stream-start" onClick={controls.start}>
          <Trans>Run nuclei on the whole slide</Trans>
        </Button>
      )}
    </section>
  );
}

function ProjectRunStreamLayer(props: RunStreamLayerProps & { readonly projectId: string }) {
  const controls = useRunStream({
    engine: props.engine,
    projectId: props.projectId,
    slideId: props.slideId,
    taskId: props.taskId,
  });
  return <RunStreamPanel controls={controls} />;
}

export function RunStreamLayer(props: RunStreamLayerProps) {
  if (props.projectId === undefined) return null;
  return <ProjectRunStreamLayer {...props} projectId={props.projectId} />;
}
