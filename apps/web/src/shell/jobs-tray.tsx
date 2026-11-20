import { t } from "@lingui/core/macro";
import {
  getListModelRunsQueryKey,
  getListMyJobsQueryKey,
  getListMyJobsQueryOptions,
  listModelRuns,
  type MyJob,
  resumeModelRun,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { showUndoToast } from "./undo-toasts.tsx";

export type JobsTrayControl = {
  open: boolean;
  setOpen: (open: boolean) => void;
  notify: (message: string, undo?: () => void) => void;
};

const JobsTrayContext = createContext<JobsTrayControl>({
  open: false,
  setOpen: () => undefined,
  notify: () => undefined,
});

export const useJobsTray = () => useContext(JobsTrayContext);

export function useOpenJobsTray(when: boolean) {
  const { setOpen } = useJobsTray();
  useEffect(() => {
    if (when) setOpen(true);
  }, [when, setOpen]);
}

export function JobsTrayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const notify = (message: string, undo?: () => void) =>
    showUndoToast({ message, ...(undo ? { undo } : {}) });
  return <JobsTrayContext value={{ open, setOpen, notify }}>{children}</JobsTrayContext>;
}

export function useResumeJob() {
  const queryClient = useQueryClient();
  return async (job: MyJob) => {
    const response = await listModelRuns(job.project.id, { batch_id: job.id });
    const runs = response.status === 200 ? response.data : [];
    const paused = runs.filter((run) => run.status === "paused");
    for (const run of paused) await resumeModelRun(job.project.id, run.id);
    await queryClient.invalidateQueries({ queryKey: getListModelRunsQueryKey(job.project.id) });
    await queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() });
    const fresh = await queryClient.query(getListMyJobsQueryOptions());
    const tile = paused[0]?.stages.find((stage) => stage.status === "running")?.units_done;
    const left = okData(fresh)?.find((item) => item.id === job.id)?.minutes_left ?? null;
    return { tile, left };
  };
}

export function resumedMessage({ tile, left }: { tile: number | undefined; left: number | null }) {
  const from = tile === undefined ? t`Resumed.` : t`Resumed from tile ${tile}.`;
  return left === null ? from : t`${from} About ${left} min left.`;
}
