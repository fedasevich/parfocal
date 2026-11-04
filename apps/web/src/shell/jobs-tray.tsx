import {
  getListModelRunsQueryKey,
  getListMyJobsQueryKey,
  getListMyJobsQueryOptions,
  listModelRuns,
  type MyJob,
  resumeModelRun,
  useListMyJobs,
} from "@parfocal/api-client";
import { JobRow, JobRowLink, JobsButton, JobsTray } from "@parfocal/ui/components/jobs";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { now } from "../clock.ts";
import {
  finishedJobs,
  type JobTarget,
  jobIcon,
  jobTarget,
  runningJobs,
  trayDetail,
  trayPercent,
  trayTone,
  trayValueText,
} from "../screens/jobs/model.ts";
import { formatBytes, type UploadEntry } from "../upload/entries.ts";
import { useUploads } from "../upload/use-uploads.ts";
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
    const left = fresh.data.find((item) => item.id === job.id)?.minutes_left ?? null;
    return { tile, left };
  };
}

export function resumedMessage({ tile, left }: { tile: number | undefined; left: number | null }) {
  const from = tile === undefined ? "Resumed." : `Resumed from tile ${tile}.`;
  return left === null ? from : `${from} About ${left} min left.`;
}

function useGoToTarget() {
  const navigate = useNavigate();
  return (target: JobTarget) => {
    if (target.kind === "job") {
      return navigate({
        to: "/projects/$projectId/jobs/$jobId",
        params: { projectId: target.projectId, jobId: target.jobId },
      });
    }
    if (target.kind === "upload") {
      return navigate({
        to: "/projects/$projectId/upload",
        params: { projectId: target.projectId },
        search: { scene: target.scene },
      });
    }
    return navigate({ to: "/projects/$projectId", params: { projectId: target.projectId } });
  };
}

type BrowserUpload = {
  projectId: string;
  count: number;
  sent: number;
  total: number;
  percent: number;
  finished: boolean;
};

function browserUploads(entries: readonly UploadEntry[]): BrowserUpload[] {
  const live = entries.filter((entry) => entry.status !== "interrupted");
  return [...new Set(live.map((entry) => entry.projectId))].map((projectId) => {
    const mine = live.filter((entry) => entry.projectId === projectId);
    const total = mine.reduce((sum, entry) => sum + entry.size, 0);
    const sent = mine.reduce(
      (sum, entry) => sum + (entry.status === "done" ? entry.size : entry.bytesUploaded),
      0,
    );
    return {
      projectId,
      count: mine.length,
      sent,
      total,
      percent: total ? Math.floor((sent * 100) / total) : 0,
      finished: sent >= total,
    };
  });
}

export function ShellJobs() {
  const tray = useJobsTray();
  const jobs = useListMyJobs().data?.data ?? [];
  const resume = useResumeJob();
  const goTo = useGoToTarget();
  const navigate = useNavigate();
  const running = runningJobs(jobs);
  const finished = finishedJobs(jobs);
  const newestUpload = jobs
    .filter((job) => job.kind === "upload")
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id;
  const today = now();
  const open = (job: MyJob) => {
    tray.setOpen(false);
    void goTo(jobTarget(job, newestUpload));
  };
  const openProject = (job: MyJob) => {
    tray.setOpen(false);
    void goTo({ kind: "project", projectId: job.project.id });
  };
  const uploads = browserUploads(useUploads().entries);
  const uploadRow = (upload: BrowserUpload) => (
    <JobRow
      key={`browser-${upload.projectId}`}
      data-testid="browser-upload-job"
      icon="upload"
      title={`${upload.finished ? "Uploaded" : "Uploading"} ${upload.count} ${upload.count === 1 ? "file" : "files"}`}
      detail={`${formatBytes(upload.sent)} of ${formatBytes(upload.total)}`}
      percent={upload.percent}
      valueText={`${upload.percent}%`}
      onOpen={() => {
        tray.setOpen(false);
        void navigate({
          to: "/projects/$projectId/upload",
          params: { projectId: upload.projectId },
          search: { scene: "progress", flow: "live" },
        });
      }}
    />
  );
  const uploadsRunning = uploads.filter((upload) => !upload.finished);
  const uploadsDone = uploads.filter((upload) => upload.finished);
  const resumeFromTray = async (job: MyJob) => {
    tray.notify(resumedMessage(await resume(job)));
  };
  const row = (job: MyJob) => (
    <JobRow
      key={job.id}
      icon={jobIcon(job)}
      title={job.title}
      detail={trayDetail(job, today)}
      percent={job.percent}
      valueText={trayValueText(job)}
      tone={trayTone(job)}
      onOpen={() => open(job)}
      action={
        job.status === "done" ? (
          <JobRowLink onClick={() => openProject(job)}>Open</JobRowLink>
        ) : job.status === "paused" ? (
          <JobRowLink onClick={() => void resumeFromTray(job)}>Resume</JobRowLink>
        ) : undefined
      }
    />
  );
  return (
    <Popover open={tray.open} onOpenChange={tray.setOpen}>
      <PopoverTrigger
        render={
          <JobsButton
            running={running.length + uploadsRunning.length}
            percent={trayPercent(jobs)}
            open={tray.open}
          />
        }
      />
      <PopoverContent align="end" aria-label="Jobs" className="w-95 gap-0 overflow-hidden p-0">
        <JobsTray
          running={[...uploadsRunning.map(uploadRow), ...running.map(row)]}
          finished={[...uploadsDone.map(uploadRow), ...finished.map(row)]}
        />
      </PopoverContent>
    </Popover>
  );
}
