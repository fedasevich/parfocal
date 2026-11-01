import {
  cancelModelRun,
  getListModelRunsQueryKey,
  getListMyJobsQueryKey,
  type ModelRun,
  type MyJob,
  resumeModelRun,
  useListModelRuns,
  useListMyJobs,
  useListProjectModels,
  useMoveModelRun,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { JobSlideList, JobSlideRow, JobStepList } from "@parfocal/ui/components/job-steps";
import { JobWindow } from "@parfocal/ui/components/job-window";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { now } from "../../clock.ts";
import { resumedMessage, useJobsTray, useResumeJob } from "../../shell/jobs-tray.tsx";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import {
  canOpenSlide,
  runSummary,
  slidePercent,
  slideTone,
  slideValueText,
  startedText,
  stepsDone,
  stepsOf,
} from "./model.ts";

type JobWindowScreenProps = {
  projectId: string;
  jobId: string;
  onClose: () => void;
};

const parfocalGpu = "Parfocal GPU";

export function JobWindowScreen({ projectId, jobId, onClose }: JobWindowScreenProps) {
  const job = useListMyJobs().data?.data.find((item) => item.id === jobId);
  const runs = okData(useListModelRuns(projectId, { batch_id: jobId }).data);
  if (!job || !runs) return null;
  return <JobWindowBody job={job} runs={runs} projectId={projectId} onClose={onClose} />;
}

function minutesSince(at: string, today: Date) {
  return Math.max(0, Math.round((today.getTime() - new Date(at).getTime()) / 60000));
}

function JobWindowBody({
  job,
  runs,
  projectId,
  onClose,
}: {
  job: MyJob;
  runs: ModelRun[];
  projectId: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    runs[0] ? { [runs[0].id]: true } : {},
  );
  const tray = useJobsTray();
  const queryClient = useQueryClient();
  const resume = useResumeJob();
  const move = useMoveModelRun();
  const personOf = usePeople();
  const models = useListProjectModels(projectId).data?.data ?? [];
  const today = now();
  const summary = runSummary(job);
  const detector = runs[0]?.parameters.detector;
  const model = models.find((item) => item.name === detector?.name);
  const by = personOf(job.started_by_user_id)?.name ?? "";
  const fileOf = (run: ModelRun) =>
    job.slides.find((slide) => slide.id === run.slide_id)?.file ?? run.slide_id;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getListModelRunsQueryKey(projectId) });
    await queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() });
  };
  const resumeNow = async () => {
    tray.notify(resumedMessage(await resume(job)));
  };
  const moveToGpu = async () => {
    const paused = runs.filter((run) => run.status === "paused");
    for (const run of paused) {
      await move.mutateAsync({ projectId, runId: run.id, data: { server: parfocalGpu } });
    }
    await refresh();
    const tile = paused[0]?.stages.find((stage) => stage.status === "running")?.units_done;
    const left = queryClient
      .getQueryData<{ data: MyJob[] }>(getListMyJobsQueryKey())
      ?.data.find((item) => item.id === job.id)?.minutes_left;
    tray.notify(
      `Moved to the ${parfocalGpu}. It picks up from tile ${tile ?? 0}, about ${left ?? 0} min left.`,
    );
  };
  const cancel = async () => {
    const first = runs[0];
    if (!first) return;
    await cancelModelRun(projectId, first.id);
    await refresh();
    onClose();
    tray.notify("Run cancelled. Slides that finished keep their results.", () => {
      void resumeModelRun(projectId, first.id).then(refresh);
    });
  };
  const footer =
    summary.state === "done" ? (
      <>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          nativeButton={false}
          render={<Link to="/projects/$projectId" params={{ projectId: job.project.id }} />}
        >
          Open the project
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => void cancel()}>
          Cancel the run
        </Button>
        <span className="flex-1" />
        <Button variant={summary.state === "paused" ? "secondary" : "primary"} onClick={onClose}>
          Close, it keeps going
        </Button>
      </>
    );
  return (
    <JobWindow
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`${job.title} · ${summary.state}`}
      subtitle={`${job.project.code} · ${startedText(job, by, today)} · ${summary.text}`}
      footer={footer}
    >
      {summary.state === "paused" && job.pause ? (
        <Zone
          highlight="warn"
          title={
            <span className="inline-flex items-center gap-2">
              <Icon name="pause" />
              Paused at {job.percent}%: the lab server stopped answering
            </span>
          }
          sub={`${job.pause.server} has not answered for ${minutesSince(job.pause.since, today)} minutes. Nothing is lost. The run picks up from the last finished tile when it resumes.`}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void resumeNow()}>
              Resume now
            </Button>
            <Button onClick={() => void moveToGpu()}>Move it to the {parfocalGpu}</Button>
          </div>
        </Zone>
      ) : null}
      <JobSlideList>
        {runs.map((run) => {
          const steps = stepsOf(run, { model, resultSet: job.title });
          return (
            <JobSlideRow
              key={run.id}
              name={fileOf(run)}
              percent={slidePercent(run)}
              valueText={slideValueText(run)}
              tone={slideTone(run)}
              thumbnail={lookUrl("overview")}
              stepsDone={Math.min(stepsDone(run), steps.length)}
              stepsTotal={steps.length}
              open={open[run.id] ?? false}
              onOpenChange={(next) => setOpen({ ...open, [run.id]: next })}
            >
              <JobStepList
                steps={steps}
                footer={
                  canOpenSlide(run) ? (
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          to="/projects/$projectId/slides/$slideId"
                          params={{ projectId: job.project.id, slideId: run.slide_id }}
                        />
                      }
                    >
                      {run.status === "done" ? "Open the slide" : "Open now with what is ready"}
                    </Button>
                  ) : undefined
                }
              />
            </JobSlideRow>
          );
        })}
      </JobSlideList>
    </JobWindow>
  );
}
