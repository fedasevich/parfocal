import { createFileRoute } from "@tanstack/react-router";
import { SetupScreen } from "../screens/onboarding/setup-screen.tsx";
import { setupSearch } from "../search/route-searches.ts";

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
