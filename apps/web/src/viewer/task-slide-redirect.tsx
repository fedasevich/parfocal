import { useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { Navigate, useLocation } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import type { SlideSearch } from "../search/route-searches.ts";
import { slidePath } from "../shell/slide-link.ts";
import type { ViewerMode } from "./viewer-mode.ts";

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
  const task = okData(useGetReviewTask(taskId).data);
  const slide = slideId ?? task?.slides[0]?.slide_id;
  if (task === undefined || slide === undefined) {
    return <Loader label={t`Loading the review`} size="page" />;
  }
  const { slide: _slide, submitted: _submitted, ...kept } = given;
  const search = Object.fromEntries(
    Object.entries({
      ...kept,
      task: taskId,
      mode,
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
