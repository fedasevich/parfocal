import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { readBuildConfig } from "../config.ts";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";
import { SignUpScreen } from "../screens/onboarding/sign-up-screen.tsx";
import { BootLoader } from "../session/boot-loader.tsx";
import { leaveFor, loginUrl, passwordSignInAvailable } from "../session/sign-in-redirect.ts";

const signUpSearch = z.object({ scene: z.enum(onboardingScenes.signup).optional() });

export const Route = createFileRoute("/sign-up")({
  validateSearch: signUpSearch,
  beforeLoad: async () => {
    if (await passwordSignInAvailable(readBuildConfig().fakeApi)) return;
    await leaveFor(loginUrl("/"));
  },
  pendingComponent: BootLoader,
  pendingMs: 0,
  pendingMinMs: 0,
  component: SignUp,
});

function SignUp() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SignUpScreen
      scene={search.scene ?? "form"}
      change={(scene) => void navigate({ search: (previous) => ({ ...previous, scene }) })}
    />
  );
}
