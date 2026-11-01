import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { SignOffScreen } from "../screens/sign-off/sign-off-screen.tsx";

const signOffSearch = z.object({
  scene: z.enum(mockScenes.signoff).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/sign-off")({
  validateSearch: signOffSearch,
  component: SignOff,
});

function SignOff() {
  const { taskId } = Route.useParams();
  const { scene } = Route.useSearch();
  return <SignOffScreen taskId={taskId} scene={scene ?? "ready"} />;
}
