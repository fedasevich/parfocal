import {
  closeDeveloperDrawer,
  openDeveloperDrawer,
  useDeveloperDrawer,
} from "../../lab/developer-drawer-state.ts";
import { setLabSetting, useLabSettings } from "../../lab/lab-settings.ts";
import { useDeveloperAllowed } from "../../lab/use-developer-allowed.ts";
import { DeveloperPanel } from "./developer-screen.tsx";

export default function DeveloperViewerDrawer() {
  const allowed = useDeveloperAllowed();
  const { section } = useDeveloperDrawer();
  const lab = useLabSettings();
  if (!allowed) return null;
  return (
    <DeveloperPanel
      section={section}
      renderer={lab.renderer}
      onSection={openDeveloperDrawer}
      onRenderer={(next) => setLabSetting("renderer", next)}
      onClose={closeDeveloperDrawer}
      className="top-0 z-30"
    />
  );
}
