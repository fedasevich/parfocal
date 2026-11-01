import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { TeamScreen } from "../screens/team/team-screen.tsx";

const teamSearch = z.object({
  scene: z.enum(mockScenes.team).optional(),
  tab: z.enum(["open", "done"]).optional(),
  project: z.string().optional(),
  reviewer: z.string().optional(),
  task: z.string().optional(),
  focus: z.string().optional(),
});

export const Route = createFileRoute("/team")({
  validateSearch: teamSearch,
  component: Team,
});

function Team() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamScreen
      search={search}
      change={(next) =>
        void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) })
      }
      openReport={(taskId) =>
        void navigate({ to: "/tasks/$taskId/evaluation", params: { taskId } })
      }
    />
  );
}
