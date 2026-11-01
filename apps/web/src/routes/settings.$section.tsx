import { useGetMyHome } from "@parfocal/api-client";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { HomeScreen } from "../screens/home/home-screen.tsx";
import { okData } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";
import { queryOfScene, settingsSectionKeys } from "../screens/settings/sections.ts";
import { SettingsScreen } from "../screens/settings/settings-screen.tsx";

const sectionSchema = z.enum(settingsSectionKeys);

const settingsSearch = z.object({
  scene: z.enum(mockScenes.settings).optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/settings/$section")({
  params: {
    parse: ({ section }) => {
      const parsed = sectionSchema.safeParse(section);
      if (!parsed.success) throw notFound();
      return { section: parsed.data };
    },
    stringify: ({ section }) => ({ section }),
  },
  validateSearch: settingsSearch,
  component: Settings,
});

function Settings() {
  const { section } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  const query = search.q ?? queryOfScene(search.scene) ?? "";
  return (
    <>
      <div inert aria-hidden="true" className="contents">
        <HomeScreen />
      </div>
      <SettingsScreen
        section={section}
        scene={search.scene}
        query={query}
        onQuery={(next) =>
          void navigate({
            replace: true,
            search: (previous) => ({ ...previous, scene: undefined, q: next || undefined }),
          })
        }
        onSection={(next) =>
          void navigate({
            to: "/settings/$section",
            replace: true,
            params: { section: next },
            search: (previous) => ({ ...previous, scene: undefined }),
          })
        }
        onEditPresets={
          resume
            ? () =>
                void navigate({
                  to: "/tasks/$taskId/guided",
                  params: { taskId: resume.task_id },
                  search: { slide: resume.slide_id, tab: "display" },
                })
            : undefined
        }
        onClose={() => {
          if (router.history.canGoBack()) router.history.back();
          else void navigate({ to: "/" });
        }}
      />
    </>
  );
}
