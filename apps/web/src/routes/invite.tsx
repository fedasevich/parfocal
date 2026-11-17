import { createFileRoute } from "@tanstack/react-router";
import { InviteScreen } from "../screens/onboarding/invite-screen.tsx";
import { inviteSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/invite")({
  validateSearch: inviteSearch,
  component: Invite,
});

function Invite() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <InviteScreen
      token={search.token}
      scene={search.scene ?? "landing"}
      change={(scene) => void navigate({ search: (previous) => ({ ...previous, scene }) })}
    />
  );
}
