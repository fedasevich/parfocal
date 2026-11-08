import { useGetMe } from "@parfocal/api-client";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { canUseDeveloperMode } from "../lab/developer-access.ts";
import { setLabSetting, useLabSettings } from "../lab/lab-settings.ts";
import {
  developerSectionKeys,
  rendererKeys,
  rendererOfDeveloperScene,
  sectionOfDeveloperScene,
} from "../screens/developer/developer-data.ts";
import { DeveloperScreen } from "../screens/developer/developer-screen.tsx";
import { okData } from "../screens/placeholder.tsx";
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
  const me = useGetMe();
  if (me.isPending) return null;
  if (!canUseDeveloperMode(okData(me.data))) return <DeveloperRefused />;
  return <DeveloperAllowed />;
}

function DeveloperRefused() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-2 p-8" data-testid="developer-refused">
      <h1 className="font-semibold text-page-title text-fg">Developer mode is not available</h1>
      <p className="text-body text-fg-dim">
        The developer drawer is for researchers. Reviewers and doctors review slides without it.
      </p>
      <Link to="/" className="text-accent underline">
        Go home
      </Link>
    </main>
  );
}

function DeveloperAllowed() {
  const search = Route.useSearch();
  const lab = useLabSettings();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const section =
    search.section ?? (search.scene ? sectionOfDeveloperScene(search.scene) : "renderer");
  const renderer =
    search.renderer ?? (search.scene ? rendererOfDeveloperScene(search.scene) : lab.renderer);
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
      onRenderer={(next) => {
        setLabSetting("renderer", next);
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, scene: undefined, section, renderer: next }),
        });
      }}
      onClose={() => {
        if (router.history.canGoBack()) router.history.back();
        else void navigate({ to: "/" });
      }}
    />
  );
}
