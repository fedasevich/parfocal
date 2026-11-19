import { useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { createFileRoute } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import { CommentsOnIds } from "../screens/review/comments-on-ids.tsx";
import { commentsSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/comments")({
  validateSearch: commentsSearch,
  component: CommentsOnTheSlide,
});

function CommentsOnTheSlide() {
  const { t } = useLingui();
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const task = okData(useGetReviewTask(taskId, { query: { enabled: !search.slide } }).data);
  const slideId = search.slide || task?.slides[0]?.slide_id;
  if (slideId === undefined) return <Loader label={t`Loading the slide`} size="page" />;
  return (
    <CommentsOnIds
      taskId={taskId}
      slideId={slideId}
      thread={search.thread}
      onThreadChange={(thread) =>
        void navigate({ search: (previous) => ({ ...previous, thread }), replace: true })
      }
    />
  );
}
