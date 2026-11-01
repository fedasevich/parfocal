import { useListMyJobs } from "@parfocal/api-client";
import { linkOptions } from "@tanstack/react-router";
import { mockScenes } from "../scenes.ts";

export const startedRunJobId = "00000000-0000-4000-8008-000000000001";

const runModelNotes = {
  pick: "Ready to run, tumor_052 and tumor_060 picked with PathoSAM",
  menu: "Choosing a model, the dropdown open",
  lab: "Your lab's model picked, on ml.cuailab.cz",
  started: "Started, the project with the jobs tray open",
} as const;

export type JobLinkIds = {
  researchProject: string;
  pausedJob: string | undefined;
  finishedJob: string | undefined;
  finishedProject: string | undefined;
};

export function jobsPrototypeLinks(ids: JobLinkIds) {
  const projectId = ids.researchProject;
  const runModel = mockScenes.runmodel.map((scene) => ({
    key: `runmodel-${scene}`,
    label: `Run a model · ${scene}`,
    note: runModelNotes[scene],
    link: linkOptions({
      to: "/projects/$projectId/run-model",
      params: { projectId },
      search: { scene },
    }),
  }));
  const job = (key: string, label: string, note: string, project: string, jobId: string) => ({
    key,
    label,
    note,
    link: linkOptions({
      to: "/projects/$projectId/jobs/$jobId",
      params: { projectId: project, jobId },
    }),
  });
  return [
    ...runModel,
    job(
      "job-run",
      "A job · run",
      "Model run in progress, one row per slide",
      projectId,
      startedRunJobId,
    ),
    ...(ids.pausedJob
      ? [job("job-cam", "A job · cam", "Paused, the lab server is busy", projectId, ids.pausedJob)]
      : []),
    ...(ids.finishedJob && ids.finishedProject
      ? [
          job(
            "job-hov",
            "A job · hov",
            "Finished, four slides in P09",
            ids.finishedProject,
            ids.finishedJob,
          ),
        ]
      : []),
  ];
}

export function useJobsPrototypeLinks(researchProject: string | undefined) {
  const jobs = useListMyJobs().data?.data ?? [];
  const paused = jobs.find((job) => job.kind === "model-run" && job.status === "paused");
  const finished = jobs.find((job) => job.kind === "model-run" && job.status === "done");
  if (researchProject === undefined) return [];
  return jobsPrototypeLinks({
    researchProject,
    pausedJob: paused?.id,
    finishedJob: finished?.id,
    finishedProject: finished?.project.id,
  });
}
