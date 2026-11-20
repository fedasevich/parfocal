import { createFileRoute, useLocation } from "@tanstack/react-router";
import { readBuildConfig } from "../config.ts";
import { safeReturnPath } from "../screens/onboarding/sign-in-rules.ts";
import { SignInScreen } from "../screens/onboarding/sign-in-screen.tsx";
import { signInSearch } from "../search/route-searches.ts";
import { BootLoader } from "../session/boot-loader.tsx";
import { leaveFor, loginUrl, passwordSignInAvailable } from "../session/sign-in-redirect.ts";

const hostedReturnOf = (returnTo: string | undefined) => safeReturnPath(returnTo) ?? "/";

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearch,
  beforeLoad: async ({ search }) => {
    if (await passwordSignInAvailable(readBuildConfig().fakeApi)) return { hostedSignIn: false };
    if (search.ended !== undefined) return { hostedSignIn: true };
    return leaveFor(loginUrl(hostedReturnOf(search.return_to)));
  },
  pendingComponent: BootLoader,
  pendingMs: 0,
  pendingMinMs: 0,
  component: SignIn,
});

function resetLinkOf(rawSearch: string) {
  const params = new URLSearchParams(rawSearch);
  const userId = params.get("user_id");
  return userId === null || userId === "" ? null : { userId, code: params.get("code") ?? "" };
}

function SignIn() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { hostedSignIn } = Route.useRouteContext();
  const rawSearch = useLocation({ select: (location) => location.searchStr });
  return (
    <SignInScreen
      scene={search.scene ?? (search.sso === "none" ? "sso" : "email")}
      returnTo={safeReturnPath(search.return_to)}
      ssoUnknown={search.sso === "none"}
      endedAfter={search.ended ?? null}
      signInAgain={
        hostedSignIn ? () => void leaveFor(loginUrl(hostedReturnOf(search.return_to))) : null
      }
      resetLink={resetLinkOf(rawSearch)}
      change={(scene) =>
        void navigate({ search: (previous) => ({ ...previous, scene, sso: undefined }) })
      }
    />
  );
}
