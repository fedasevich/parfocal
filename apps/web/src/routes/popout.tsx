import { createFileRoute } from "@tanstack/react-router";
import { PopoutScreen } from "../popout/popout-screen.tsx";
import { popoutSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/popout")({
  validateSearch: popoutSearch,
  component: PopoutRoute,
});

function PopoutRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PopoutScreen
      search={search}
      onSearch={(change) =>
        void navigate({ search: (previous) => ({ ...previous, ...change }), replace: true })
      }
    />
  );
}
