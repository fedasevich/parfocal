import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { readBuildConfig } from "../config.ts";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";
import { safeReturnPath } from "../screens/onboarding/sign-in-rules.ts";
import { SignInScreen } from "../screens/onboarding/sign-in-screen.tsx";
import { loginUrl, passwordSignInAvailable } from "../session/sign-in-redirect.ts";

const signInSearch = z.object({
  scene: z.enum(onboardingScenes.signin).optional(),
  return_to: z.string().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearch,
  beforeLoad: async ({ search }) => {
    if (await passwordSignInAvailable(readBuildConfig().fakeApi)) return;
    window.location.assign(loginUrl(safeReturnPath(search.return_to) ?? "/"));
  },
  component: SignIn,
});

function SignIn() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SignInScreen
      scene={search.scene ?? "email"}
      returnTo={safeReturnPath(search.return_to)}
      change={(scene) => void navigate({ search: (previous) => ({ ...previous, scene }) })}
    />
  );
}
