import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar, type PersonInfo, type Presence } from "@parfocal/ui/components/person";
import { CategoryTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

function Brand({ className }: { className?: string }) {
  return (
    <span data-slot="brand" className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <Icon name="parfocal" size="md" className="text-accent" />
      <b className="text-body font-semibold text-fg">Parfocal</b>
    </span>
  );
}

type TopBarProps = React.ComponentProps<"header"> & {
  user: PersonInfo;
  presence?: Presence;
  unread?: number;
  jobs?: number;
};

function TopBar({
  user,
  presence = "available",
  unread = 0,
  jobs = 0,
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
      <Brand />
      <span className="flex-1" />
      <button
        type="button"
        className="flex w-105 cursor-pointer items-center gap-2 rounded-ctl border border-line-strong bg-transparent px-2.5 py-1.5 text-left text-body-sm text-fg-faint"
      >
        <Icon name="search" />
        <span className="flex-1 truncate">Search projects, slides, IDs like T2·C145</span>
        <Keycap keys="⌘K" />
      </button>
      <span className="flex-1" />
      <Button variant="ghost">
        <Icon name="folder" />
        New project
      </Button>
      <Button variant="ghost">
        <Icon name="upload" />
        Upload
      </Button>
      {jobs > 0 ? (
        <Button variant="ghost" aria-label={`${jobs} jobs running`}>
          <Icon name="clock" />
          {jobs}
        </Button>
      ) : null}
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
      <button
        type="button"
        aria-haspopup="menu"
        className="cursor-pointer rounded-full border-0 bg-transparent p-0"
      >
        <PersonAvatar person={user} size={28} presence={presence} />
        <span className="sr-only">Account menu</span>
      </button>
    </header>
  );
}

type SidebarItem = {
  id: string;
  label: string;
  icon?: IconName;
  color?: string;
  count?: number;
  tag?: string;
};

type SidebarSection = { title?: string; items: SidebarItem[] };

type SidebarProps = React.ComponentProps<"nav"> & {
  sections: SidebarSection[];
  active?: string;
};

function Sidebar({ sections, active, className, ...props }: SidebarProps) {
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
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={active === item.id ? "page" : undefined}
              className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-md px-2.5 py-1.75 text-body-sm whitespace-nowrap text-fg-dim no-underline hover:bg-chrome-2 hover:text-fg aria-[current=page]:bg-chrome-2 aria-[current=page]:font-medium aria-[current=page]:text-fg"
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
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
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
  Sidebar,
  type SidebarItem,
  type SidebarProps,
  type SidebarSection,
  TopBar,
  type TopBarProps,
};
