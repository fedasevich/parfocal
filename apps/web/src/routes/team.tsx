import { createFileRoute } from "@tanstack/react-router";
import { TeamScreen } from "../screens/team/team-screen.tsx";
import { teamSearch } from "../search/route-searches.ts";

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
