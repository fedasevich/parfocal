import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
  label: MessageDescriptor;
  icon: NonNullable<SidebarSection["items"][number]["icon"]>;
  sub: MessageDescriptor;
}[] = [
  { key: "overview", label: msg`Overview`, icon: "board", sub: msg`at a glance` },
  {
    key: "people",
    label: msg`People and roles`,
    icon: "users",
    sub: msg`Who can sign in and what each role can do`,
  },
  {
    key: "projects",
    label: msg`Projects`,
    icon: "folder",
    sub: msg`Every project in the workspace, its privacy and the space it uses`,
  },
  {
    key: "models",
    label: msg`AI models`,
    icon: "smart",
    sub: msg`Parfocal's models are always here. Connect your lab's own models next to them`,
  },
  {
    key: "templates",
    label: msg`Report templates`,
    icon: "file",
    sub: msg`Study templates build the evaluation report from blocks and fill in a new review task`,
  },
  {
    key: "storage",
    label: msg`Storage and sources`,
    icon: "database",
    sub: msg`Space used, and the servers slides are read from`,
  },
  {
    key: "api",
    label: msg`API and webhooks`,
    icon: "link",
    sub: msg`Tokens and webhooks for pipelines`,
  },
  {
    key: "audit",
    label: msg`Audit log`,
    icon: "list",
    sub: msg`Who did what and when. Nobody can change it, people with admin rights included`,
  },
  {
    key: "security",
    label: msg`Security`,
    icon: "shield",
    sub: msg`Sign-in, sessions and where data is kept`,
  },
  {
    key: "settings",
    label: msg`Workspace settings`,
    icon: "sliders",
    sub: msg`Lock times, model tiers, what new work starts with and announcements`,
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
  const { t } = useLingui();

  const me = okData(useGetMe().data);
  const projects = okData(useListProjects().data) ?? [];
  const jobs = okData(useListMyJobs().data) ?? [];
  const overlay = useOverlay();
  const goTo = useGoTo();
  const renderLink = useRouterLink();
  const person = personOf(me);
  const workspace = workspaceBrand(me);
  const sections: SidebarSection[] = [
    {
      items: [{ id: "back", href: destinations.home(), label: t`Back to Parfocal`, icon: "back" }],
    },
    {
      title: workspace ? t`Admin · ${workspace.name}` : t`Admin`,
      items: adminSectionList.map((item) => ({
        id: item.key,
        href: adminHref(item.key),
        label: t(item.label),
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
            aria-label={t`Admin sections`}
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
