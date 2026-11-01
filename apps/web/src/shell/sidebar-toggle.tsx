import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { createContext, useContext } from "react";

export type ShellSidebar = { folded: boolean; open: boolean; toggle: () => void };

export const ShellSidebarContext = createContext<ShellSidebar>({
  folded: false,
  open: true,
  toggle: () => undefined,
});

export const useShellSidebar = () => useContext(ShellSidebarContext);

export function SidebarToggle() {
  const sidebar = useShellSidebar();
  if (!sidebar.folded) return null;
  const label = sidebar.open ? "Hide the sidebar" : "Show the sidebar";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={sidebar.open}
      onClick={sidebar.toggle}
    >
      <Icon name="panel" />
    </Button>
  );
}
