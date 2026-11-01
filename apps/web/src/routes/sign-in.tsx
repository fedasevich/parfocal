import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";
import { SignInScreen } from "../screens/onboarding/sign-in-screen.tsx";

const signInSearch = z.object({ scene: z.enum(onboardingScenes.signin).optional() });

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearch,
  component: SignIn,
});

function SignIn() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SignInScreen
      scene={search.scene ?? "email"}
      change={(scene) => void navigate({ search: (previous) => ({ ...previous, scene }) })}
    />
  );
}
