import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const teamSearch = z.object({
  scene: z.enum(mockScenes.team).optional(),
});

export const Route = createFileRoute("/team")({
  validateSearch: teamSearch,
  component: Team,
});

function Team() {
  const search = Route.useSearch();
  return <Placeholder title="Team" builtBy="PROTO-013 (Team)" route={{ search }} />;
}
