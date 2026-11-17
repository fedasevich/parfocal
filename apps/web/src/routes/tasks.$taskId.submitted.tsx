import { createFileRoute } from "@tanstack/react-router";
import { SlideSubmitted } from "../screens/review/slide-submitted.tsx";
import { submittedSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/submitted")({
  validateSearch: submittedSearch,
  component: SubmittedThenNextSlide,
});

function SubmittedThenNextSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  return <SlideSubmitted taskId={taskId} slideId={search.slide ?? ""} />;
}
