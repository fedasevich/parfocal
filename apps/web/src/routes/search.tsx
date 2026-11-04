import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SearchScreen } from "../screens/search/search-screen.tsx";
import { searchScopes } from "../shell/search-hits.ts";

const scopeValues = searchScopes.map((scope) => scope.value) as [
  (typeof searchScopes)[number]["value"],
  ...(typeof searchScopes)[number]["value"][],
];

const searchPage = z.object({
  q: z.string().optional(),
  scope: z.enum(scopeValues).optional(),
});

export const Route = createFileRoute("/search")({
  validateSearch: searchPage,
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SearchScreen
      state={{ q: search.q ?? "", scope: search.scope ?? "all" }}
      change={(next) =>
        void navigate({
          replace: true,
          search: (previous) => ({
            ...previous,
            ...next,
            ...(next.q === "" ? { q: undefined } : {}),
            ...(next.scope === "all" ? { scope: undefined } : {}),
          }),
        })
      }
    />
  );
}
