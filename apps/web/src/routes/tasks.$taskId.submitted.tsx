import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";

const submittedSearch = z.object({
  slide: z.string().optional(),
});

export const Route = createFileRoute("/tasks/$taskId/submitted")({
  validateSearch: submittedSearch,
  component: SubmittedThenNextSlide,
});

function SubmittedThenNextSlide() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Submitted, then the next slide"
      builtBy="PROTO-007 (guided review, the Slide done card and the next slide)"
      route={{ params, search }}
    />
  );
}
