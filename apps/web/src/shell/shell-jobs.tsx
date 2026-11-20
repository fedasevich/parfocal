import { Trans, useLingui } from "@lingui/react/macro";
import { type MyJob, useListMyJobs } from "@parfocal/api-client";
import { JobRow, JobRowLink, JobsButton, JobsTray } from "@parfocal/ui/components/jobs";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { useNavigate } from "@tanstack/react-router";
import { now } from "../clock.ts";
import {
  finishedJobs,
  finishedTarget,
  type JobTarget,
  jobIcon,
  jobTarget,
  runningJobs,
  trayDetail,
  trayPercent,
  trayTone,
  trayValueText,
} from "../screens/jobs/model.ts";
import { okData } from "../screens/placeholder.tsx";
import { formatBytes, type UploadEntry } from "../upload/entries.ts";
import { useUploads } from "../upload/use-uploads.ts";
import { resumedMessage, useJobsTray, useResumeJob } from "./jobs-tray.tsx";
import { slideLink } from "./slide-link.ts";

function useGoToTarget() {
  const navigate = useNavigate();
  return (target: JobTarget) => {
    if (target.kind === "job") {
      return navigate({
        to: "/projects/$projectId/jobs/$jobId",
        params: { projectId: target.projectId, jobId: target.jobId },
      });
    }
    if (target.kind === "slide") {
      return navigate(slideLink({ projectId: target.projectId, slideId: target.slideId }));
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
  const { t } = useLingui();

  const tray = useJobsTray();
  const jobs = okData(useListMyJobs().data) ?? [];
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
  const openFinished = (job: MyJob) => {
    tray.setOpen(false);
    void goTo(finishedTarget(job));
  };
  const uploads = browserUploads(useUploads().entries);
  const uploadRow = (upload: BrowserUpload) => (
    <JobRow
      key={`browser-${upload.projectId}`}
      data-testid="browser-upload-job"
      icon="upload"
      title={`${upload.finished ? t`Uploaded` : t`Uploading`} ${upload.count} ${upload.count === 1 ? "file" : "files"}`}
      detail={t`${formatBytes(upload.sent)} of ${formatBytes(upload.total)}`}
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
          <JobRowLink onClick={() => openFinished(job)}>
            <Trans>Open</Trans>
          </JobRowLink>
        ) : job.status === "paused" ? (
          <JobRowLink onClick={() => void resumeFromTray(job)}>
            <Trans>Resume</Trans>
          </JobRowLink>
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
      <PopoverContent align="end" aria-label={t`Jobs`} className="w-95 gap-0 overflow-hidden p-0">
        <JobsTray
          running={[...uploadsRunning.map(uploadRow), ...running.map(row)]}
          finished={[...uploadsDone.map(uploadRow), ...finished.map(row)]}
        />
      </PopoverContent>
    </Popover>
  );
}
