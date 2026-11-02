import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import type * as React from "react";

type WorkspaceBrand = {
  name: string;
  subtitle?: string;
  logo?: string;
  color?: string;
};

type WorkspaceOption = WorkspaceBrand & {
  id: string;
  organisation?: string | undefined;
};

function WorkspaceLogo({ workspace }: { workspace: WorkspaceBrand }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6.5 shrink-0 place-items-center rounded-md text-caption font-bold text-white"
      style={{ background: workspace.color }}
    >
      {workspace.logo}
    </span>
  );
}

function WorkspaceLabel({ workspace }: { workspace: WorkspaceBrand }) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <b className="truncate text-body-sm font-semibold text-fg">{workspace.name}</b>
      {workspace.subtitle ? (
        <small className="truncate text-caption text-fg-dim">{workspace.subtitle}</small>
      ) : null}
    </span>
  );
}

type WorkspaceButtonProps = React.ComponentProps<"button"> & { workspace: WorkspaceBrand };

function WorkspaceButton({ workspace, ...props }: WorkspaceButtonProps) {
  return (
    <button
      type="button"
      data-slot="workspace-switch"
      title="Switch workspace"
      className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left hover:bg-chrome-2 aria-expanded:bg-chrome-2"
      {...props}
    >
      <WorkspaceLogo workspace={workspace} />
      <WorkspaceLabel workspace={workspace} />
      <Icon name="down" className="text-fg-dim" />
    </button>
  );
}

const byOrganisation = (workspaces: WorkspaceOption[]) => {
  const groups = new Map<string, WorkspaceOption[]>();
  for (const workspace of workspaces) {
    const key = workspace.organisation ?? "";
    groups.set(key, [...(groups.get(key) ?? []), workspace]);
  }
  return [...groups.entries()];
};

type WorkspaceSwitcherProps = {
  workspace: WorkspaceBrand;
  workspaces: WorkspaceOption[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  switchingId?: string | undefined;
  defaultOpen?: boolean | undefined;
};

function WorkspaceSwitcher({
  workspace,
  workspaces,
  activeId,
  onSelect,
  switchingId,
  defaultOpen,
}: WorkspaceSwitcherProps) {
  return (
    <DropdownMenu {...(defaultOpen === undefined ? {} : { defaultOpen })}>
      <DropdownMenuTrigger
        data-slot="workspace-switch"
        render={<WorkspaceButton workspace={workspace} />}
      />
      <DropdownMenuContent align="start" className="w-[300px] p-1.5">
        {byOrganisation(workspaces).map(([organisation, members]) => (
          <DropdownMenuGroup key={organisation}>
            {organisation ? (
              <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-fg-dim">
                {organisation}
              </DropdownMenuLabel>
            ) : null}
            {members.map((option) => {
              const current = option.id === activeId;
              return (
                <DropdownMenuItem
                  key={option.id}
                  aria-current={current ? "true" : undefined}
                  disabled={switchingId !== undefined}
                  onClick={() => {
                    if (!current) onSelect(option.id);
                  }}
                  className="grid grid-cols-[26px_1fr_16px] items-center gap-2.5 px-2.5 py-1.5"
                >
                  <WorkspaceLogo workspace={option} />
                  <WorkspaceLabel workspace={option} />
                  {current ? (
                    <Icon name="check" className="text-accent" />
                  ) : switchingId === option.id ? (
                    <Icon name="clock" className="text-fg-dim" />
                  ) : (
                    <span />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export {
  type WorkspaceBrand,
  WorkspaceButton,
  type WorkspaceOption,
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
};
