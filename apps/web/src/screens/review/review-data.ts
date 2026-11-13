import {
  type MyDisplay,
  type Neighbours,
  type Opinion,
  type ReviewDecision,
  type ReviewObject,
  type ReviewTaskDetail,
  type Thread,
  useGetMe,
  useGetMyDisplay,
  useGetOpinion,
  useGetReviewTask,
  useGetSlideNeighbours,
  useListDecisions,
  useListProjectClasses,
  useListProjects,
  useListReviewObjects,
  useListThreads,
} from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { formatDue } from "../format.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { type ReviewStyle, toReviewStyle } from "./decision-style.ts";
import { type TaskDisplayView, taskDisplayView } from "./display-model.ts";
import { fromMentionTokensOrNull } from "./mention-picking.ts";

export type SlideThread = {
  id: string;
  slide_id: string;
  task_id: string | null;
  anchor: string;
  replies: number;
  resolved: boolean;
};

export const toSlideThreads = (threads: Thread[]): SlideThread[] =>
  threads.flatMap((thread) =>
    thread.anchor.object_id
      ? [
          {
            id: thread.id,
            slide_id: thread.slide_id,
            task_id: thread.task_id,
            anchor: thread.anchor.object_id,
            replies: Math.max(0, thread.message_count - 1),
            resolved: thread.resolved_at !== null,
          },
        ]
      : [],
  );

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
  decisions: Map<string, ReviewDecision>;
  style: ReviewStyle;
  classes: ProjectClass[];
  display: TaskDisplayView | undefined;
  myDisplay: MyDisplay | undefined;
  opinion: Opinion | undefined;
  neighbours: Neighbours | undefined;
  threads: SlideThread[];
  meId: string | undefined;
  nodeStaging: boolean;
  slideSize: { width: number; height: number } | null;
  ready: boolean;
};

export function useReviewSession(taskId: string, slideId: string): ReviewSession {
  const task = okData(useGetReviewTask(taskId).data);
  const projectId = task?.project_id ?? "";
  const objectsQuery = useListReviewObjects(taskId, slideId);
  const reviewObjects = objectsQuery.data?.data;
  const decisions = okData(useListDecisions(taskId, slideId).data) ?? [];
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name;
  const myDisplay = okData(useGetMyDisplay(taskId).data);
  const opinion = okData(useGetOpinion(taskId, slideId).data);
  const neighbours = okData(useGetSlideNeighbours(slideId, { from: "task", task_id: taskId }).data);
  const classes = okData(
    useListProjectClasses(projectId, { query: { enabled: projectId !== "" } }).data,
  );
  const threads = toSlideThreads(okData(useListThreads(taskId, slideId).data) ?? []);
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
    decisions: new Map(
      decisions.map((decision) => [
        decision.object,
        { ...decision, note: fromMentionTokensOrNull(decision.note, nameOf) },
      ]),
    ),
    style: toReviewStyle(task?.decision),
    classes: (classes ?? []).map((item) => ({ id: item.id, name: item.name, color: item.colour })),
    display: myDisplay ? taskDisplayView(myDisplay, task?.code ?? "") : undefined,
    myDisplay,
    opinion,
    neighbours,
    threads,
    meId: me?.user_id,
    nodeStaging: task?.analysis_template === "sentinel-node",
    slideSize: slide?.width && slide.height ? { width: slide.width, height: slide.height } : null,
    ready: task !== undefined && reviewObjects !== undefined,
  };
}
