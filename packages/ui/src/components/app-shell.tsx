import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar, type PersonInfo, type Presence } from "@parfocal/ui/components/person";
import { CategoryTag } from "@parfocal/ui/components/tag";
import { type WorkspaceBrand, WorkspaceButton } from "@parfocal/ui/components/workspace-switcher";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type LinkRendererProps = {
  href: string;
  className?: string;
  title?: string;
  "aria-current"?: "page" | undefined;
  children: React.ReactNode;
};

type LinkRenderer = (props: LinkRendererProps) => React.ReactNode;

const anchorLink: LinkRenderer = ({ children, ...props }) => <a {...props}>{children}</a>;

type BrandProps = {
  className?: string;
  workspace?: WorkspaceBrand | undefined;
  homeHref?: string | undefined;
  renderLink?: LinkRenderer | undefined;
  onWorkspaceClick?: (() => void) | undefined;
  workspaceSlot?: React.ReactNode;
};

function Brand({
  className,
  workspace,
  homeHref,
  renderLink = anchorLink,
  onWorkspaceClick,
  workspaceSlot,
}: BrandProps) {
  const mark = (
    <>
      <Icon name="parfocal" size="md" className="text-accent" />
      <b className="text-body font-semibold text-fg">Parfocal</b>
    </>
  );
  return (
    <span data-slot="brand" className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {homeHref
        ? renderLink({
            href: homeHref,
            title: "Parfocal home",
            className: "flex items-center gap-2.5 no-underline",
            children: mark,
          })
        : mark}
      {workspace ? (
        <>
          <i aria-hidden="true" className="mx-1 h-5.5 w-px bg-line-strong" />
          {workspaceSlot !== undefined ? (
            workspaceSlot
          ) : (
            <WorkspaceButton workspace={workspace} onClick={onWorkspaceClick} />
          )}
        </>
      ) : null}
    </span>
  );
}

type TopBarProps = React.ComponentProps<"header"> & {
  user: PersonInfo;
  presence?: Presence;
  unread?: number;
  jobs?: number;
  workspace?: WorkspaceBrand | undefined;
  homeHref?: string | undefined;
  renderLink?: LinkRenderer | undefined;
  onWorkspaceClick?: (() => void) | undefined;
  workspaceSlot?: React.ReactNode;
  onSearch?: (() => void) | undefined;
  onNewProject?: (() => void) | undefined;
  onUpload?: (() => void) | undefined;
  jobsSlot?: React.ReactNode;
  bellSlot?: React.ReactNode;
  accountSlot?: React.ReactNode;
};

function TopBar({
  user,
  presence = "available",
  unread = 0,
  jobs = 0,
  workspace,
  homeHref,
  renderLink,
  onWorkspaceClick,
  workspaceSlot,
  onSearch,
  onNewProject,
  onUpload,
  jobsSlot,
  bellSlot,
  accountSlot,
  className,
  ...props
}: TopBarProps) {
  return (
    <header
      data-slot="top-bar"
      className={cn(
        "flex h-11 items-center gap-2.5 border-b border-line bg-chrome px-2.5 text-body-sm",
        className,
      )}
      {...props}
    >
      <Brand
        workspace={workspace}
        homeHref={homeHref}
        renderLink={renderLink}
        onWorkspaceClick={onWorkspaceClick}
        workspaceSlot={workspaceSlot}
      />
      <span className="flex-1" />
      <button
        type="button"
        onClick={onSearch}
        className="flex w-105 cursor-pointer items-center gap-2 rounded-ctl border border-line-strong bg-transparent px-2.5 py-1.5 text-left text-body-sm text-fg-faint"
      >
        <Icon name="search" />
        <span className="flex-1 truncate">Search projects, slides, IDs like T2·C145</span>
        <Keycap keys="⌘K" />
      </button>
      <span className="flex-1" />
      <Button variant="ghost" onClick={onNewProject}>
        <Icon name="folder" />
        New project
      </Button>
      <Button variant="ghost" onClick={onUpload}>
        <Icon name="upload" />
        Upload
      </Button>
      {jobsSlot !== undefined ? (
        jobsSlot
      ) : jobs > 0 ? (
        <Button variant="ghost" aria-label={`${jobs} jobs running`}>
          <Icon name="clock" />
          {jobs}
        </Button>
      ) : null}
      {bellSlot !== undefined ? (
        bellSlot
      ) : (
        <span className="relative">
          <Button variant="ghost" size="icon" aria-label={`Notifications, ${unread} unread`}>
            <Icon name="bell" />
          </Button>
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0.5 right-px h-4 min-w-4 rounded-lg bg-accent-fill px-1 text-center text-label leading-4 font-bold text-on-accent"
            >
              {unread}
            </span>
          ) : null}
        </span>
      )}
      {accountSlot !== undefined ? (
        accountSlot
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          className="cursor-pointer rounded-full border-0 bg-transparent p-0"
        >
          <PersonAvatar person={user} size={28} presence={presence} />
          <span className="sr-only">Account menu</span>
        </button>
      )}
    </header>
  );
}

type SidebarItem = {
  id: string;
  href?: string;
  label: string;
  icon?: IconName;
  color?: string;
  count?: number;
  tag?: string;
};

type SidebarSection = { title?: string; items: SidebarItem[] };

type SidebarProps = React.ComponentProps<"nav"> & {
  sections: SidebarSection[];
  active?: string | undefined;
  renderLink?: LinkRenderer | undefined;
};

function Sidebar({ sections, active, renderLink = anchorLink, className, ...props }: SidebarProps) {
  return (
    <nav
      data-slot="sidebar"
      aria-label="Main"
      className={cn("flex w-60 flex-col gap-0.5 overflow-hidden px-3 py-4.5", className)}
      {...props}
    >
      {sections.map((section) => (
        <div key={section.title ?? "top"} className="grid gap-0.5">
          {section.title ? (
            <div className="px-2.5 pt-5 pb-1.5 text-caption font-semibold text-fg-dim">
              {section.title}
            </div>
          ) : null}
          {section.items.map((item) => (
            <SidebarLink
              key={item.id}
              href={item.href ?? `#${item.id}`}
              current={active === item.id}
              renderLink={renderLink}
            >
              {item.color ? (
                <i
                  aria-hidden="true"
                  className="size-3 justify-self-center rounded-[3px]"
                  style={{ background: item.color }}
                />
              ) : item.icon ? (
                <Icon name={item.icon} size="md" />
              ) : (
                <span />
              )}
              <span className="truncate">{item.label}</span>
              {item.tag ? (
                <CategoryTag>{item.tag}</CategoryTag>
              ) : item.count !== undefined ? (
                <span className="font-mono text-caption text-fg-faint">{item.count}</span>
              ) : (
                <span />
              )}
            </SidebarLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarLink({
  href,
  current,
  renderLink,
  children,
}: {
  href: string;
  current: boolean;
  renderLink: LinkRenderer;
  children: React.ReactNode;
}) {
  return renderLink({
    href,
    "aria-current": current ? "page" : undefined,
    className:
      "grid grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-md px-2.5 py-1.75 text-body-sm whitespace-nowrap text-fg-dim no-underline hover:bg-chrome-2 hover:text-fg aria-[current=page]:bg-chrome-2 aria-[current=page]:font-medium aria-[current=page]:text-fg",
    children,
  });
}

type AppShellProps = React.ComponentProps<"div"> & {
  top: React.ReactNode;
  side?: React.ReactNode;
};

function AppShell({ top, side, className, children, ...props }: AppShellProps) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-surf-page text-fg",
        className,
      )}
      {...props}
    >
      {top}
      <div className={cn("grid min-h-0", side ? "grid-cols-[240px_minmax(0,1fr)]" : "")}>
        {side}
        <div className="min-h-0 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export {
  AppShell,
  type AppShellProps,
  Brand,
  type BrandProps,
  type LinkRenderer,
  type LinkRendererProps,
  Sidebar,
  type SidebarItem,
  type SidebarProps,
  type SidebarSection,
  TopBar,
  type TopBarProps,
  type WorkspaceBrand,
};
