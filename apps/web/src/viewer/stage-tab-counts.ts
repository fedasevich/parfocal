import { useListReviewObjects, useListThreads, useListThreadsOnSlide } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";

export type StageTabCounts = Partial<Record<ViewerTab, number>>;

export function useStageTabCounts(link: {
  projectId: string | undefined;
  taskId: string | undefined;
  reviewTaskId: string | null;
  slideId: string;
}): StageTabCounts {
  const objects = useListReviewObjects(link.reviewTaskId ?? "", link.slideId, {
    query: { enabled: link.reviewTaskId !== null },
  });
  const onTask = useListThreads(link.taskId ?? "", link.slideId, undefined, {
    query: { enabled: link.taskId !== undefined },
  });
  const onSlide = useListThreadsOnSlide(link.projectId ?? "", link.slideId, undefined, {
    query: { enabled: link.projectId !== undefined },
  });
  const objectCount = link.reviewTaskId === null ? 0 : (okData(objects.data)?.objects.length ?? 0);
  const threads = [
    ...(link.taskId === undefined ? [] : (okData(onTask.data) ?? [])),
    ...(link.projectId === undefined ? [] : (okData(onSlide.data) ?? [])),
  ];
  return {
    objects: objectCount,
    comments: threads.filter((thread) => thread.resolved_at === null).length,
  };
}
