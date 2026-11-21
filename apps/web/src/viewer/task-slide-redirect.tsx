import { useLingui } from "@lingui/react/macro";
import {
  getListMyReviewTasksQueryKey,
  listMyReviewTasks,
  type MyTask,
  type ReviewTaskDetail,
  useGetReviewTask,
} from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import type { SlideSearch } from "../search/route-searches.ts";
import { NotFoundPage } from "../shell/issue-pages.tsx";
import { slidePath } from "../shell/slide-link.ts";
import type { ViewerMode } from "./viewer-mode.ts";

export function firstOpenSlide(
  task: ReviewTaskDetail | undefined,
  mine: readonly MyTask[] | undefined,
): string | undefined {
  if (task === undefined) return undefined;
  const slides = task.slides.map((slide) => slide.slide_id);
  const next = mine?.find((candidate) => candidate.id === task.id)?.next_slide_id;
  return next && slides.includes(next) ? next : slides[0];
}

export function TaskSlideRedirect({
  taskId,
  slideId,
  mode,
}: {
  taskId: string;
  slideId: string | undefined;
  mode: ViewerMode;
}) {
  const { t } = useLingui();
  const given = useLocation({ select: (location) => location.search }) as Record<string, unknown>;
  const query = useGetReviewTask(taskId);
  const task = okData(query.data);
  const visit = useLocation({ select: (location) => location.state.__TSR_key ?? "" });
  const mine = useQuery({
    queryKey: [...getListMyReviewTasksQueryKey(), "open-slide", taskId, visit],
    queryFn: ({ signal }) => listMyReviewTasks({ signal }),
    enabled: slideId === undefined,
    staleTime: 0,
    gcTime: 0,
  });
  const choosing = slideId === undefined && mine.isPending;
  const slide = slideId ?? firstOpenSlide(task, okData(mine.data));
  if (task === undefined && !query.isPending) return <NotFoundPage />;
  if (task !== undefined && !choosing && slide === undefined) {
    return <Navigate to="/projects/$projectId" params={{ projectId: task.project_id }} replace />;
  }
  if (task === undefined || choosing || slide === undefined) {
    return <Loader label={t`Loading the review`} size="page" />;
  }
  const { slide: _slide, submitted: _submitted, ...kept } = given;
  const search = Object.fromEntries(
    Object.entries({
      ...kept,
      task: taskId,
      mode: task.kind === "annotate" ? "annotate" : mode,
      tab: kept["tab"] === "review" ? "objects" : kept["tab"],
    }).filter(([, value]) => value !== undefined),
  ) as unknown as SlideSearch;
  return (
    <Navigate
      to={slidePath}
      params={{ projectId: task.project_id, slideId: slide }}
      search={search}
      replace
    />
  );
}
