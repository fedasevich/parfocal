import { createFileRoute } from "@tanstack/react-router";
import { SlideSubmitted } from "../screens/review/slide-submitted.tsx";
import { submittedSearch } from "../search/route-searches.ts";
import { TaskSlideRedirect } from "../viewer/task-slide-redirect.tsx";

export const Route = createFileRoute("/tasks/$taskId/submitted")({
  validateSearch: submittedSearch,
  component: SubmittedThenNextSlide,
});

function SubmittedThenNextSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  if (search.slide === undefined) {
    return <TaskSlideRedirect taskId={taskId} slideId={undefined} mode="review" />;
  }
  return <SlideSubmitted taskId={taskId} slideId={search.slide} />;
}
