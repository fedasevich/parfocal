import { createFileRoute } from "@tanstack/react-router";
import { MyWorkScreen } from "../screens/my-work/my-work-screen.tsx";
import { tabOf } from "../screens/my-work/scenes.ts";
import { myWorkSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/my-work")({
  validateSearch: myWorkSearch,
  component: MyWork,
});

function MyWork() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MyWorkScreen
      state={{
        tab: tabOf(search.tab, search.scene),
        sel: search.sel,
        q: search.q ?? "",
        filters: {
          project: search.project,
          status: search.status,
          set: search.set,
          reviewer: search.reviewer,
          storage: search.storage,
        },
        scene: search.scene,
      }}
      change={({ filters, ...next }) =>
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, ...next, ...filters }),
        })
      }
    />
  );
}
