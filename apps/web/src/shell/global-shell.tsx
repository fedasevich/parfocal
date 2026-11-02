import {
  type Me,
  useGetMe,
  useGetMyHome,
  useListMyAdjudications,
  useListMyReviewTasks,
  useListProjects,
} from "@parfocal/api-client";
import { AppShell, Sidebar, type SidebarSection, TopBar } from "@parfocal/ui/components/app-shell";
import type { PersonInfo } from "@parfocal/ui/components/person";
import { avatarColour } from "@parfocal/ui/lib/avatar-colours";
import { useMatches, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { projectColour } from "../screens/palette.ts";
import { okData } from "../screens/placeholder.tsx";
import { AccountMenu } from "./account-menu.tsx";
import { Bell } from "./bell.tsx";
import { destinations } from "./destinations.ts";
import { JobsTrayProvider, ShellJobs } from "./jobs-tray.tsx";
import { useOverlay } from "./overlays.ts";
import { useGoTo, useRouterLink } from "./router-link.tsx";
import { foldedShellRouteIds } from "./shell-routes.ts";
import { ShellSidebarContext } from "./sidebar-toggle.tsx";
import { ShellWorkspaceSwitcher, workspaceBrand } from "./workspace-switcher.tsx";

export function personOf(me: Me | undefined): PersonInfo {
  return {
    name: me?.display_name ?? "",
    initials: me?.initials ?? "",
    color: avatarColour(me?.avatar_colour ?? 0),
    ...(me?.title ? { role: me.title } : {}),
  };
}

export function useToReviewCount(): number {
  const tasks = okData(useListMyReviewTasks().data) ?? [];
  const adjudications = useListMyAdjudications().data?.data ?? [];
  const active = tasks.filter(
    (task) => task.status === "in-review" || task.status === "not-started",
  );
  return active.length + adjudications.length;
}

function useActiveItem(): string | undefined {
  const params = useParams({ strict: false });
  const ids = useMatches({ select: (matches) => matches.map((match) => match.routeId as string) });
  if (ids.includes("/")) return "home";
  if (ids.includes("/my-work")) return "my-work";
  if (ids.includes("/team")) return "team";
  return params.projectId;
}

export function GlobalShell({ children }: { children: ReactNode }) {
  const me = okData(useGetMe().data);
  const projects = okData(useListProjects().data) ?? [];
  const homeProjects = okData(useGetMyHome().data)?.projects ?? [];
  const toReview = useToReviewCount();
  const overlay = useOverlay();
  const goTo = useGoTo();
  const renderLink = useRouterLink();
  const active = useActiveItem();
  const folded = useMatches({
    select: (matches) => matches.some((match) => foldedShellRouteIds.has(match.routeId)),
  });
  const [navOpen, setNavOpen] = useState(false);
  const showSide = !folded || navOpen;
  const firstProject = projects[0]?.id ?? "";
  const slidesIn = (id: string) => homeProjects.find((project) => project.id === id)?.slides;
  const sections: SidebarSection[] = [
    {
      items: [
        { id: "home", href: destinations.home(), label: "Home", icon: "home" },
        {
          id: "my-work",
          href: destinations.myWork(),
          label: "My work",
          icon: "slides",
          ...(toReview > 0 ? { count: toReview } : {}),
        },
      ],
    },
    {
      title: "Projects",
      items: [
        ...projects.map((project) => {
          const slides = slidesIn(project.id);
          return {
            id: project.id,
            href: destinations.project(project.id),
            label: project.name,
            color: projectColour(project.colour),
            ...(slides === undefined ? {} : { count: slides }),
          };
        }),
        {
          id: "new-project",
          href: destinations.newProject(),
          label: "New project",
          icon: "folder",
        },
      ],
    },
    {
      title: "Workspace",
      items: [
        { id: "team", href: destinations.team(), label: "Team", icon: "users" },
        { id: "admin", href: destinations.admin(), label: "Admin", icon: "sliders" },
      ],
    },
  ];
  const person = personOf(me);
  return (
    <JobsTrayProvider>
      <AppShell
        className="h-dvh"
        top={
          <TopBar
            user={person}
            workspace={workspaceBrand(me)}
            workspaceSlot={<ShellWorkspaceSwitcher me={me} />}
            homeHref={destinations.home()}
            renderLink={renderLink}
            jobsSlot={<ShellJobs />}
            onSearch={() => void overlay.set("palette")}
            onNewProject={() => void goTo(destinations.newProject())}
            onUpload={() => void goTo(destinations.upload(firstProject))}
            bellSlot={<Bell />}
            accountSlot={<AccountMenu me={me} person={person} />}
          />
        }
        side={
          showSide ? <Sidebar sections={sections} active={active} renderLink={renderLink} /> : null
        }
      >
        <ShellSidebarContext value={{ folded, open: showSide, toggle: () => setNavOpen(!navOpen) }}>
          {children}
        </ShellSidebarContext>
      </AppShell>
    </JobsTrayProvider>
  );
}
