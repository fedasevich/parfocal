import { useGetMe, useListMyJobs, useListProjects } from "@parfocal/api-client";
import { AppShell, Sidebar, type SidebarSection, TopBar } from "@parfocal/ui/components/app-shell";
import type { ReactNode } from "react";
import { AccountMenu } from "../../shell/account-menu.tsx";
import { Bell } from "../../shell/bell.tsx";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useOverlay } from "../../shell/overlays.ts";
import { useGoTo, useRouterLink } from "../../shell/router-link.tsx";
import { ShellWorkspaceSwitcher, workspaceBrand } from "../../shell/workspace-switcher.tsx";
import type { AdminSection } from "../onboarding/scenes.ts";
import { okData } from "../placeholder.tsx";

export const adminSectionList: {
  key: AdminSection;
  label: string;
  icon: NonNullable<SidebarSection["items"][number]["icon"]>;
  sub: string;
}[] = [
  { key: "overview", label: "Overview", icon: "board", sub: "at a glance" },
  {
    key: "people",
    label: "People and roles",
    icon: "users",
    sub: "Who can sign in and what each role can do",
  },
  {
    key: "projects",
    label: "Projects",
    icon: "folder",
    sub: "Every project in the workspace, its privacy and the space it uses",
  },
  {
    key: "models",
    label: "AI models",
    icon: "smart",
    sub: "Parfocal's models are always here. Connect your lab's own models next to them",
  },
  {
    key: "templates",
    label: "Report templates",
    icon: "file",
    sub: "Study templates build the evaluation report from blocks and fill in a new review task",
  },
  {
    key: "storage",
    label: "Storage and sources",
    icon: "database",
    sub: "Space used, and the servers slides are read from",
  },
  { key: "api", label: "API and webhooks", icon: "link", sub: "Tokens and webhooks for pipelines" },
  {
    key: "audit",
    label: "Audit log",
    icon: "list",
    sub: "Who did what and when. Nobody can change it, people with admin rights included",
  },
  {
    key: "security",
    label: "Security",
    icon: "shield",
    sub: "Sign-in, sessions and where data is kept",
  },
  {
    key: "settings",
    label: "Workspace settings",
    icon: "sliders",
    sub: "Lock times, model tiers, what new work starts with and announcements",
  },
];

export const adminHref = (section: AdminSection) => `/admin?section=${section}`;

export function AdminShell({
  section,
  folded,
  children,
}: {
  section: AdminSection;
  folded?: boolean;
  children: ReactNode;
}) {
  const me = okData(useGetMe().data);
  const projects = okData(useListProjects().data) ?? [];
  const jobs = useListMyJobs().data?.data ?? [];
  const overlay = useOverlay();
  const goTo = useGoTo();
  const renderLink = useRouterLink();
  const person = personOf(me);
  const workspace = workspaceBrand(me);
  const sections: SidebarSection[] = [
    { items: [{ id: "back", href: destinations.home(), label: "Back to Parfocal", icon: "back" }] },
    {
      title: workspace ? `Admin · ${workspace.name}` : "Admin",
      items: adminSectionList.map((item) => ({
        id: item.key,
        href: adminHref(item.key),
        label: item.label,
        icon: item.icon,
      })),
    },
  ];
  return (
    <AppShell
      className="h-dvh"
      top={
        <TopBar
          user={person}
          workspace={workspace}
          workspaceSlot={<ShellWorkspaceSwitcher me={me} />}
          homeHref={destinations.home()}
          renderLink={renderLink}
          jobs={jobs.filter((job) => job.status !== "done").length}
          onSearch={() => void overlay.set("palette")}
          onUpload={() => void goTo(destinations.upload(projects[0]?.id ?? ""))}
          bellSlot={<Bell />}
          accountSlot={<AccountMenu me={me} person={person} />}
        />
      }
      side={
        folded ? null : (
          <Sidebar
            aria-label="Admin sections"
            sections={sections}
            active={section}
            renderLink={renderLink}
            className="w-auto"
          />
        )
      }
    >
      {children}
    </AppShell>
  );
}
