import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { type WorkspaceOption, WorkspaceSwitcher } from "../src/components/workspace-switcher.tsx";

const workspaces: WorkspaceOption[] = [
  {
    id: "fn-vltava",
    name: "Fakultní nemocnice Vltava",
    subtitle: "Pathology and AI research",
    organisation: "FN Vltava",
    logo: "FV",
    color: "#0f766e",
  },
  {
    id: "fn-vltava-diagnostic",
    name: "FN Vltava diagnostics",
    subtitle: "Diagnostic workspace",
    organisation: "FN Vltava",
    logo: "FD",
    color: "#2563eb",
  },
  {
    id: "cu-ai-lab",
    name: "Charles University AI Lab",
    subtitle: "Pathology and AI research",
    organisation: "Charles University",
    logo: "CU",
    color: "#7c3aed",
  },
];

function Switcher({ open, switching }: { open?: boolean; switching?: string }) {
  const [active, setActive] = useState("fn-vltava");
  const current = workspaces.find((workspace) => workspace.id === active) ?? workspaces[0];
  if (current === undefined) return null;
  return (
    <div className="flex h-[320px] items-start gap-4 bg-chrome p-4">
      <WorkspaceSwitcher
        workspace={current}
        workspaces={workspaces}
        activeId={active}
        onSelect={setActive}
        switchingId={switching}
        defaultOpen={open}
      />
      <output aria-label="Active workspace" className="text-body-sm text-fg-dim">
        {active}
      </output>
    </div>
  );
}

const meta = {
  title: "Shell/Workspace switcher",
  component: Switcher,
} satisfies Meta<typeof Switcher>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = { args: {} };

export const Open: Story = { args: { open: true } };

export const Switching: Story = { args: { open: true, switching: "cu-ai-lab" } };
