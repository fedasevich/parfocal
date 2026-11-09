import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { SearchScreen } from "../screens/search/search-screen.tsx";
import { handoffText } from "../shell/search-handoff.ts";
import { searchScopes } from "../shell/search-hits.ts";

const scopeValues = searchScopes.map((scope) => scope.value) as [
  (typeof searchScopes)[number]["value"],
  ...(typeof searchScopes)[number]["value"][],
];

const searchPage = z.object({
  scope: z.enum(scopeValues).optional(),
});

export const Route = createFileRoute("/search")({
  validateSearch: searchPage,
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
