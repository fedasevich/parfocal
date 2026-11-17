import { createFileRoute } from "@tanstack/react-router";
import { readBuildConfig } from "../config.ts";
import { safeReturnPath } from "../screens/onboarding/sign-in-rules.ts";
import { SignInScreen } from "../screens/onboarding/sign-in-screen.tsx";
import { signInSearch } from "../search/route-searches.ts";
import { BootLoader } from "../session/boot-loader.tsx";
import { leaveFor, loginUrl, passwordSignInAvailable } from "../session/sign-in-redirect.ts";

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearch,
  beforeLoad: async ({ search }) => {
    if (await passwordSignInAvailable(readBuildConfig().fakeApi)) return;
    await leaveFor(loginUrl(safeReturnPath(search.return_to) ?? "/"));
  },
  pendingComponent: BootLoader,
  pendingMs: 0,
  pendingMinMs: 0,
  component: SignIn,
});

function SignIn() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SignInScreen
      scene={search.scene ?? (search.sso === "none" ? "sso" : "email")}
      returnTo={safeReturnPath(search.return_to)}
      ssoUnknown={search.sso === "none"}
      change={(scene) =>
        void navigate({ search: (previous) => ({ ...previous, scene, sso: undefined }) })
      }
    />
  );
}
