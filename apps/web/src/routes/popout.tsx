import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PopoutScreen } from "../popout/popout-screen.tsx";
import { mockScenes } from "../screens/scenes.ts";
import { viewerTabs } from "../screens/viewer/viewer-scenes.ts";

const popoutSearch = z.object({
  kind: z.enum(["minimap", "inspector"]).optional(),
  project: z.string().optional(),
  slide: z.string().optional(),
  task: z.string().optional(),
  scene: z
    .enum([
      ...mockScenes.case,
      ...mockScenes.layers,
      ...mockScenes.navigator,
      ...mockScenes.compare,
    ])
    .optional(),
  tab: z.enum(viewerTabs).optional(),
  object: z.string().optional(),
});

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
