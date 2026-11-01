import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { InviteScreen } from "../screens/onboarding/invite-screen.tsx";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";

const inviteSearch = z.object({
  token: z.string().min(1).default("rt14-simona"),
  scene: z.enum(onboardingScenes.invite).optional(),
});

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
