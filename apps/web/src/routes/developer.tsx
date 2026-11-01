import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import {
  developerSectionKeys,
  rendererKeys,
  rendererOfDeveloperScene,
  sectionOfDeveloperScene,
} from "../screens/developer/developer-data.ts";
import { DeveloperScreen } from "../screens/developer/developer-screen.tsx";
import { mockScenes } from "../screens/scenes.ts";

const developerSearch = z.object({
  scene: z.enum(mockScenes.developer).optional(),
  section: z.enum(developerSectionKeys).optional(),
  renderer: z.enum(rendererKeys).optional(),
});

export const Route = createFileRoute("/developer")({
  validateSearch: developerSearch,
  component: Developer,
});

function Developer() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const section =
    search.section ?? (search.scene ? sectionOfDeveloperScene(search.scene) : "renderer");
  const renderer = search.renderer ?? rendererOfDeveloperScene(search.scene);
  return (
    <DeveloperScreen
      section={section}
      renderer={renderer}
      onSection={(next) =>
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, scene: undefined, section: next, renderer }),
        })
      }
      onRenderer={(next) =>
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, scene: undefined, section, renderer: next }),
        })
      }
      onClose={() => {
        if (router.history.canGoBack()) router.history.back();
        else void navigate({ to: "/" });
      }}
    />
  );
}
