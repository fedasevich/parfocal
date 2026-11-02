import type { State } from "@parfocal/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MyWorkScreen } from "../screens/my-work/my-work-screen.tsx";
import { tabOf } from "../screens/my-work/scenes.ts";
import { statusChoices } from "../screens/my-work/slide-filters.ts";

const myWorkSearch = z.object({
  tab: z.enum(["review", "assigned", "all"]).optional(),
  sel: z.string().optional(),
  q: z.string().optional(),
  project: z.string().optional(),
  status: z.enum(statusChoices.map((choice) => choice.value) as [State, ...State[]]).optional(),
  set: z.string().optional(),
  reviewer: z.string().optional(),
  scene: z.enum(["review", "preview", "anna", "assigned", "all", "allpreview"]).optional(),
});

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
