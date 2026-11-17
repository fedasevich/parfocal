import { createFileRoute } from "@tanstack/react-router";
import { AdjudicatorView } from "../screens/disagreements/adjudicator-view.tsx";
import { type QueueScene, QueueScreen } from "../screens/disagreements/queue-screen.tsx";
import { disagreementsSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/disagreements")({
  validateSearch: disagreementsSearch,
  component: Disagreements,
});

function Disagreements() {
  const { taskId } = Route.useParams();
  const { scene } = Route.useSearch();
  if (scene === "adjudicate" || scene === "adjdone") return <AdjudicatorView taskId={taskId} />;
  const queueScene: QueueScene = scene ?? "queue";
  return <QueueScreen key={queueScene} taskId={taskId} scene={queueScene} />;
}
