import { useGetMyHome } from "@parfocal/api-client";
import { useRouter, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { type SettingsSection, settingsSectionKeys } from "../screens/settings/section-keys.ts";

const SettingsScreen = lazy(async () => ({
  default: (await import("../screens/settings/settings-screen.tsx")).SettingsScreen,
}));

const settingsHref = /^\/settings\/([a-z-]+)$/;

const openedHere = "settingsOverlay";

export function settingsSectionOfHref(href: string): SettingsSection | undefined {
  const key = settingsHref.exec(href)?.[1];
  return settingsSectionKeys.find((section) => section === key);
}

const openedHereFlag = (state: unknown) =>
  typeof state === "object" &&
  state !== null &&
  Object.entries(state).some(([key, value]) => key === openedHere && value === true);

export function useOpenSettings() {
  const router = useRouter();
  return (section: SettingsSection) => {
    const location = router.state.location;
    if (location.pathname.startsWith("/settings/")) {
      return router.navigate({ href: `/settings/${section}` });
    }
    const alreadyOpen = (location.search as { settings?: unknown }).settings !== undefined;
    return router.navigate({
      to: ".",
      replace: alreadyOpen,
      search: (previous: Record<string, unknown>) => ({ ...previous, settings: section }),
      state: alreadyOpen ? location.state : ({ [openedHere]: true } as never),
    });
  };
}

function useCloseSettings() {
  const router = useRouter();
  return () => {
    if (openedHereFlag(router.state.location.state) && router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void router.navigate({
      to: ".",
      replace: true,
      search: (previous: Record<string, unknown>) => ({ ...previous, settings: undefined }),
    });
  };
}

export function SettingsOverlayHost() {
  const section = useSearch({ strict: false }).settings;
  if (section === undefined) return null;
  return (
    <Suspense fallback={null}>
      <OpenSettings section={section} />
    </Suspense>
  );
}

function OpenSettings({ section }: { section: SettingsSection }) {
  const router = useRouter();
  const close = useCloseSettings();
  const [query, setQuery] = useState("");
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  return (
    <SettingsScreen
      section={section}
      scene={undefined}
      query={query}
      onQuery={setQuery}
      onSection={(next) =>
        void router.navigate({
          to: ".",
          replace: true,
          search: (previous: Record<string, unknown>) => ({ ...previous, settings: next }),
          state: router.state.location.state,
        })
      }
      onEditPresets={
        resume
          ? () =>
              void router.navigate({
                to: "/tasks/$taskId/guided",
                params: { taskId: resume.task_id },
                search: { slide: resume.slide_id, tab: "display" },
              })
          : undefined
      }
      onClose={close}
    />
  );
}
