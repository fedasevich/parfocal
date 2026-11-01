import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";
import { SetupScreen } from "../screens/onboarding/setup-screen.tsx";

const setupSearch = z.object({
  step: z.enum(onboardingScenes.setup).optional(),
  scene: z.enum(onboardingScenes.setup).optional(),
});

export const Route = createFileRoute("/setup")({
  validateSearch: setupSearch,
  component: Setup,
});

function Setup() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SetupScreen
      step={search.step ?? search.scene ?? "role"}
      change={(step) => void navigate({ search: { step } })}
    />
  );
}
