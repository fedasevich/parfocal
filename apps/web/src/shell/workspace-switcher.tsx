import { type Me, useSwitchWorkspace, type Workspace } from "@parfocal/api-client";
import {
  type WorkspaceBrand,
  type WorkspaceOption,
  WorkspaceSwitcher,
} from "@parfocal/ui/components/workspace-switcher";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { destinations } from "./destinations.ts";
import { useGoTo } from "./router-link.tsx";

const workspaceColours = ["#0f766e", "#7c3aed", "#2563eb", "#b45309"];

const subtitles: Record<Workspace["kind"], string> = {
  diagnostic: "Diagnostic workspace",
  research: "Pathology and AI research",
  "second-opinion": "Second-opinion network",
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((word) => /^\p{Lu}/u.test(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

function optionOf(workspace: Workspace, index: number): WorkspaceOption {
  return {
    id: workspace.tenant_id,
    name: workspace.name,
    subtitle: subtitles[workspace.kind],
    organisation: workspace.organisation_name ?? undefined,
    logo: initialsOf(workspace.name),
    color: workspaceColours[index % workspaceColours.length] ?? "#0f766e",
  };
}

export function workspaceOptions(me: Me | undefined): WorkspaceOption[] {
  return (me?.workspaces ?? [])
    .map(optionOf)
    .filter((_, index) => me?.workspaces[index]?.status !== "suspended");
}

export function workspaceBrand(me: Me | undefined): WorkspaceBrand | undefined {
  const index = me?.workspaces.findIndex((item) => item.tenant_id === me.active_tenant_id) ?? -1;
  const workspace = me?.workspaces[index];
  return workspace === undefined ? undefined : optionOf(workspace, index);
}

export function ShellWorkspaceSwitcher({ me }: { me: Me | undefined }) {
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const router = useRouter();
  const switching = useSwitchWorkspace({
    mutation: {
      onSuccess: async () => {
        const [, params] = router.getMatchedRoutes(router.latestLocation.pathname);
        if (Object.keys(params).length > 0) await goTo(destinations.home());
        await queryClient.resetQueries();
      },
    },
  });
  const brand = workspaceBrand(me);
  if (brand === undefined) return null;
  return (
    <WorkspaceSwitcher
      workspace={brand}
      workspaces={workspaceOptions(me)}
      activeId={me?.active_tenant_id ?? undefined}
      switchingId={switching.isPending ? switching.variables.data.tenant_id : undefined}
      onSelect={(tenantId) => switching.mutate({ data: { tenant_id: tenantId } })}
    />
  );
}
