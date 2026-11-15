import {
  ApiError,
  getGetReviewTaskQueryKey,
  getListSlideResultSetsQueryKey,
  getModelRun,
  type JobStatus,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { joinableSetOf, runEnded } from "../annotations/annotate-run.ts";
import type { AnnotateTask } from "../annotations/annotate-task.ts";
import {
  addRun,
  sharedAiObjectsKey,
  sharedLayerKey,
  slideStatusKey,
} from "../annotations/annotate-task-api.ts";

const watchMs = 2000;

export type TaskRunPhase =
  | "idle"
  | "running"
  | "joining"
  | "joined"
  | "scoped"
  | "ended"
  | "failed";

export type TaskRunJoin = {
  readonly phase: TaskRunPhase;
  readonly runId: string | null;
  readonly status: JobStatus | null;
  readonly code: string;
  readonly watch: (runId: string) => void;
};

const problemCode = (error: unknown) =>
  error instanceof ApiError ? (error.problem?.code ?? `${error.status}`) : "network";

export function useTaskRunJoin(options: {
  readonly projectId: string;
  readonly task: AnnotateTask | null;
  readonly onJoined: () => void;
}): TaskRunJoin {
  const { projectId, task } = options;
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<TaskRunPhase>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [code, setCode] = useState("");
  const latest = useRef({ task, onJoined: options.onJoined });
  latest.current = { task, onJoined: options.onJoined };

  const watch = useCallback((id: string) => {
    setRunId(id);
    setStatus(null);
    setPhase("running");
  }, []);

  useEffect(() => {
    if (runId === null) return;
    let stopped = false;
    let looking = false;
    const refresh = (current: AnnotateTask) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetReviewTaskQueryKey(current.taskId) }),
        queryClient.invalidateQueries({
          queryKey: sharedLayerKey(current.taskId, current.slideId),
        }),
        queryClient.invalidateQueries({
          queryKey: sharedAiObjectsKey(current.taskId, current.slideId),
        }),
        queryClient.invalidateQueries({
          queryKey: slideStatusKey(current.taskId, current.slideId),
        }),
        queryClient.invalidateQueries({
          queryKey: getListSlideResultSetsQueryKey(current.slideId),
        }),
      ]);
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
        const current = latest.current.task;
        const setId = current === null ? null : joinableSetOf(run, current);
        if (current === null || setId === null) {
          setPhase("ended");
          return;
        }
        setPhase("joining");
        const joined = await addRun(current.taskId, current.slideId, setId);
        await refresh(current);
        const pinned = joined.data.result_set_id === setId;
        if (pinned) latest.current.onJoined();
        setPhase(pinned ? "joined" : "scoped");
      } catch (error) {
        stopped = true;
        setCode(problemCode(error));
        setPhase("failed");
      } finally {
        looking = false;
      }
    };
    const timer = setInterval(() => void look(), watchMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, projectId, queryClient]);

  return { phase, runId, status, code, watch };
}
