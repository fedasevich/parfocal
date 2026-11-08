import {
  type Neighbours,
  type Opinion,
  type ReviewObject,
  type ReviewTaskDetail,
  type SlideThread,
  type TaskDisplay,
  useGetMe,
  useGetOpinion,
  useGetReviewTask,
  useGetSlideNeighbours,
  useGetTaskDisplay,
  useListProjectClasses,
  useListProjects,
  useListReviewObjects,
  useListSlideThreads,
  useListVerdicts,
  type Verdict,
} from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { formatDue } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { type ReviewStyle, toReviewStyle } from "./decision-style.ts";

export type ReviewSession = {
  taskId: string;
  slideId: string;
  task: ReviewTaskDetail | undefined;
  taskName: string;
  taskSub: string;
  slideName: string;
  caseLabel: string | null;
  objects: ReviewObject[];
  added: { object: string; note: string | null }[];
  verdicts: Map<string, Verdict>;
  style: ReviewStyle;
  classes: ProjectClass[];
  display: TaskDisplay | undefined;
  opinion: Opinion | undefined;
  neighbours: Neighbours | undefined;
  threads: SlideThread[];
  meId: string | undefined;
  nodeStaging: boolean;
  ready: boolean;
};

export function useReviewSession(taskId: string, slideId: string): ReviewSession {
  const task = okData(useGetReviewTask(taskId).data);
  const projectId = task?.project_id ?? "";
  const objectsQuery = useListReviewObjects(taskId, slideId);
  const reviewObjects = objectsQuery.data?.data;
  const verdicts = okData(useListVerdicts(taskId, slideId).data) ?? [];
  const display = useGetTaskDisplay(taskId).data?.data;
  const opinion = okData(useGetOpinion(taskId, slideId).data);
  const neighbours = okData(useGetSlideNeighbours(slideId, { from: "task", task_id: taskId }).data);
  const classes = okData(
    useListProjectClasses(projectId, { query: { enabled: projectId !== "" } }).data,
  );
  const threads = useListSlideThreads(slideId).data?.data ?? [];
  const me = okData(useGetMe().data);
  const projectName =
    okData(useListProjects().data)?.find((project) => project.id === projectId)?.name ?? "";
  const slide = reviewObjects?.slide;
  return {
    taskId,
    slideId,
    task,
    taskName: task?.name ?? "",
    taskSub: task?.due_on ? `${projectName} · due ${formatDue(task.due_on)}` : projectName,
    slideName: slide ? `${slide.label} · ${slide.stain}` : "",
    caseLabel: slide?.case_label ?? null,
    objects: reviewObjects?.objects ?? [],
    added: reviewObjects?.added ?? [],
    verdicts: new Map(verdicts.map((verdict) => [verdict.object, verdict])),
    style: toReviewStyle(task?.decision),
    classes: (classes ?? []).map((item) => ({ id: item.id, name: item.name, color: item.colour })),
    display,
    opinion,
    neighbours,
    threads,
    meId: me?.user_id,
    nodeStaging: task?.analysis_template === "sentinel-node",
    ready: task !== undefined && reviewObjects !== undefined,
  };
}
