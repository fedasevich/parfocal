import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const signOffSearch = z.object({
  scene: z.enum(mockScenes.signoff).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/sign-off")({
  validateSearch: signOffSearch,
  component: SignOff,
});

function SignOff() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Sign off the evaluation"
      builtBy="PROTO-008 (disagreements, sign-off and the evaluation report)"
      route={{ params, search }}
    />
  );
}
