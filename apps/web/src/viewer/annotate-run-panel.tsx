import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  getGetReviewTaskQueryKey,
  getListSlideResultSetsQueryKey,
  getModelRun,
  type JobStatus,
  startModelRuns,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AnnotateRunScope,
  annotateRunDraft,
  joinableSetOf,
  runEnded,
  selectionScopeOf,
  viewScopeOf,
} from "../annotations/annotate-run.ts";
import type { AnnotateTask } from "../annotations/annotate-task.ts";
import {
  addRun,
  sharedAiObjectsKey,
  sharedLayerKey,
  slideStatusKey,
} from "../annotations/annotate-task-api.ts";
import type { Shape, ShapeId } from "../annotations/shapes.ts";
import { type ViewerEngine, viewArea } from "./viewer-engine.ts";

const watchMs = 2000;

type Phase = "idle" | "starting" | "running" | "joining" | "joined" | "ended" | "failed";

type AnnotateRunPanelProps = {
  readonly engine: ViewerEngine;
  readonly stage: HTMLElement;
  readonly projectId: string;
  readonly task: AnnotateTask;
  readonly shapes: ReadonlyMap<ShapeId, Shape>;
  readonly selectedIds: readonly ShapeId[];
};

const problemCode = (error: unknown) =>
  error instanceof ApiError ? (error.problem?.code ?? `${error.status}`) : "network";

function Status({ phase, status, code }: { phase: Phase; status: JobStatus | null; code: string }) {
  if (phase === "starting") return <Trans>Starting the run</Trans>;
  if (phase === "running") return <Trans>The run is streaming onto the slide</Trans>;
  if (phase === "joining") return <Trans>Adding the run to the task</Trans>;
  if (phase === "joined") return <Trans>Its objects are AI objects of this task now</Trans>;
  if (phase === "ended") return <Trans>The run ended as {status}, nothing was added</Trans>;
  if (phase === "failed") return <Trans>The server refused it ({code})</Trans>;
  return <Trans>Draw or select a shape to run on it, or run on this view</Trans>;
}

export function AnnotateRunPanel(props: AnnotateRunPanelProps) {
  const { engine, stage, projectId, task, shapes, selectedIds } = props;
  const { taskId, slideId } = task;
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [scope, setScope] = useState<AnnotateRunScope | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [code, setCode] = useState("");
  const selection = selectionScopeOf(shapes, selectedIds);
  const busy = phase === "starting" || phase === "running" || phase === "joining";

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetReviewTaskQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: sharedLayerKey(taskId, slideId) }),
        queryClient.invalidateQueries({ queryKey: sharedAiObjectsKey(taskId, slideId) }),
        queryClient.invalidateQueries({ queryKey: slideStatusKey(taskId, slideId) }),
        queryClient.invalidateQueries({ queryKey: getListSlideResultSetsQueryKey(slideId) }),
      ]),
    [queryClient, taskId, slideId],
  );

  const fail = useCallback((error: unknown) => {
    setCode(problemCode(error));
    setPhase("failed");
  }, []);

  const start = async (chosen: AnnotateRunScope) => {
    const slide = engine.getSlide();
    const { width, height } = stage.getBoundingClientRect();
    const runScope =
      chosen === "selection"
        ? selection
        : slide === null
          ? null
          : viewScopeOf(viewArea(engine.getCamera(), { width, height }), slide);
    if (runScope === null) return;
    setScope(chosen);
    setPhase("starting");
    setStatus(null);
    try {
      const answer = await startModelRuns(
        projectId,
        annotateRunDraft({ slideId, taskId, scope: runScope }),
      );
      const [run] = answer.status === 201 ? answer.data : [];
      if (run === undefined) throw new Error("No run started");
      setRunId(run.id);
      setStatus(run.status);
      setPhase("running");
    } catch (error) {
      fail(error);
    }
  };

  const latest = useRef({ task, refresh, fail });
  latest.current = { task, refresh, fail };
  useEffect(() => {
    if (runId === null) return;
    let stopped = false;
    let looking = false;
    const look = async () => {
      if (stopped || looking) return;
      looking = true;
      try {
        const answer = await getModelRun(projectId, runId);
        if (stopped || answer.status !== 200) return;
        const run = answer.data;
        setStatus(run.status);
        if (!runEnded(run.status)) return;
        stopped = true;
        const { task: current, refresh: reload } = latest.current;
        const setId = joinableSetOf(run, current);
        if (setId === null) {
          setPhase("ended");
          return;
        }
        setPhase("joining");
        await addRun(current.taskId, current.slideId, setId);
        await reload();
        setPhase("joined");
      } catch (error) {
        stopped = true;
        latest.current.fail(error);
      } finally {
        looking = false;
      }
    };
    const timer = setInterval(() => void look(), watchMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, projectId]);

  return (
    <section
      aria-label={t`Run a model`}
      data-testid="annotate-run"
      data-phase={phase}
      data-scope={scope ?? "none"}
      data-run={runId ?? ""}
      className="pointer-events-auto absolute right-4 bottom-16 z-10 grid w-72 gap-2 rounded-ctl border border-line bg-chrome p-3 text-caption shadow-sm"
    >
      <p role="status" className="m-0 text-body-sm text-fg-dim" data-testid="annotate-run-status">
        <Status phase={phase} status={status} code={code} />
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid="annotate-run-selection"
          disabled={busy || selection === null}
          onClick={() => void start("selection")}
        >
          <Trans>Run on the selection</Trans>
        </Button>
        <Button
          size="sm"
          data-testid="annotate-run-view"
          disabled={busy}
          onClick={() => void start("view")}
        >
          <Trans>Run on this view</Trans>
        </Button>
      </div>
    </section>
  );
}
