import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CommentsOnIds } from "../screens/review/comments-on-ids.tsx";

const commentsSearch = z.object({
  slide: z.string().optional(),
  thread: z.string().optional(),
});

export const Route = createFileRoute("/tasks/$taskId/comments")({
  validateSearch: commentsSearch,
  component: CommentsOnTheSlide,
});

function CommentsOnTheSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CommentsOnIds
      taskId={taskId}
      slideId={search.slide ?? ""}
      thread={search.thread}
      onThreadChange={(thread) =>
        void navigate({ search: (previous) => ({ ...previous, thread }), replace: true })
      }
    />
  );
}
