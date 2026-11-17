import { createFileRoute } from "@tanstack/react-router";
import { CommentsOnIds } from "../screens/review/comments-on-ids.tsx";
import { commentsSearch } from "../search/route-searches.ts";

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
