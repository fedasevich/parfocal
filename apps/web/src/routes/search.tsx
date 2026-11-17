import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SearchScreen } from "../screens/search/search-screen.tsx";
import { searchPageSearch } from "../search/route-searches.ts";
import { handoffText } from "../shell/search-handoff.ts";

export const Route = createFileRoute("/search")({
  validateSearch: searchPageSearch,
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const carried = useLocation({ select: (location) => handoffText(location.state) });
  const [q, setQ] = useState(carried);
  useEffect(() => {
    if (carried) void navigate({ replace: true, search: (previous) => previous, state: {} });
  }, [carried, navigate]);
  return (
    <SearchScreen
      state={{ q, scope: search.scope ?? "all" }}
      change={(next) => {
        if (next.q !== undefined) setQ(next.q);
        if (next.scope !== undefined) {
          void navigate({
            replace: true,
            search: (previous) => ({
              ...previous,
              scope: next.scope === "all" ? undefined : next.scope,
            }),
          });
        }
      }}
    />
  );
}
