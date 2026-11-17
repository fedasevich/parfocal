import { createFileRoute } from "@tanstack/react-router";
import { SignOffScreen } from "../screens/sign-off/sign-off-screen.tsx";
import { signOffSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/sign-off")({
  validateSearch: signOffSearch,
  component: SignOff,
});

function SignOff() {
  const { taskId } = Route.useParams();
  const { scene } = Route.useSearch();
  return <SignOffScreen taskId={taskId} scene={scene ?? "ready"} />;
}
