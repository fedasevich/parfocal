import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SlideSubmitted } from "../screens/review/slide-submitted.tsx";

const submittedSearch = z.object({
  slide: z.string().optional(),
});

export const Route = createFileRoute("/tasks/$taskId/submitted")({
  validateSearch: submittedSearch,
  component: SubmittedThenNextSlide,
});

function SubmittedThenNextSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  return <SlideSubmitted taskId={taskId} slideId={search.slide ?? ""} />;
}
