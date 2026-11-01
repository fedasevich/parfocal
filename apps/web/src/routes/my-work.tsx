import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MyWorkScreen } from "../screens/my-work/my-work-screen.tsx";
import { tabOf } from "../screens/my-work/scenes.ts";

const myWorkSearch = z.object({
  tab: z.enum(["review", "assigned", "all"]).optional(),
  sel: z.string().optional(),
  q: z.string().optional(),
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
        scene: search.scene,
      }}
      change={(next) =>
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, ...next }),
        })
      }
    />
  );
}
