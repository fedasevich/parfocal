import { useGetFirstRead, useGetMe, useGetReviewTask, useListMySlides } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { blindedOn } from "./blinded.ts";

export function useBlindedOn(taskId: string | undefined, slideId: string): boolean {
  const me = okData(useGetMe().data)?.user_id;
  const inTask = taskId !== undefined;
  const task = okData(useGetReviewTask(taskId ?? "", { query: { enabled: inTask } }).data);
  const projectId = task?.project_id ?? "";
  const firstRead = useGetFirstRead(taskId ?? "", slideId, undefined, {
    query: { enabled: inTask && task?.ai_hidden_first_read === true, retry: false },
  });
  const mySlides = okData(
    useListMySlides(
      { project_id: projectId },
      { query: { enabled: projectId !== "" && task?.blinded === true } },
    ).data,
  )?.slides;
  const myState = mySlides
    ?.find((slide) => slide.id === slideId)
    ?.reviews.find((review) => review.task_id === taskId && review.user_id === me)?.state;
  return blindedOn({
    taskId,
    slideId,
    me,
    task,
    firstReadRecorded: firstRead.isSuccess,
    myState,
  });
}
