import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { FullViewer } from "../screens/viewer/full-viewer.tsx";
import { viewerTabs } from "../screens/viewer/viewer-scenes.ts";

const slideSearch = z.object({
  task: z.string().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  z: z.number().min(0).max(20).optional(),
  object: z.string().optional(),
  scene: z.enum([...mockScenes.case, ...mockScenes.layers]).optional(),
  tab: z.enum(viewerTabs).optional(),
  modal: z.enum(["preset"]).optional(),
});

export type SlideSearch = z.infer<typeof slideSearch>;

export const Route = createFileRoute("/projects/$projectId/slides/$slideId")({
  validateSearch: slideSearch,
  component: SlideView,
});

function SlideView() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FullViewer
      projectId={projectId}
      slideId={slideId}
      search={search}
      onSearch={(change) =>
        void navigate({ search: (previous) => ({ ...previous, ...change }), replace: true })
      }
    />
  );
}
