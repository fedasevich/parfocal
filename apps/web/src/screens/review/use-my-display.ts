import { type MyDisplay, useGetMe, useGetMyDisplay, useGetReviewTask } from "@parfocal/api-client";
import { okData } from "../placeholder.tsx";
import { reviewsTask, taskDefaultDisplay } from "./display-model.ts";

export function useMyDisplay(taskId: string | undefined): MyDisplay | undefined {
  const task = okData(
    useGetReviewTask(taskId ?? "", { query: { enabled: taskId !== undefined } }).data,
  );
  const me = okData(useGetMe().data)?.user_id;
  const reviewing = task !== undefined && me !== undefined && reviewsTask(task, me);
  const mine = okData(
    useGetMyDisplay(taskId ?? "", { query: { enabled: taskId !== undefined && reviewing } }).data,
  );
  if (task === undefined || me === undefined) return undefined;
  return reviewing ? mine : taskDefaultDisplay(task);
}
