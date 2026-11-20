import { lazy, Suspense } from "react";
import { useDeveloperDrawer } from "./developer-drawer-state.ts";

const DeveloperViewerDrawer = lazy(
  () => import("../screens/developer/developer-viewer-drawer.tsx"),
);

export function DeveloperDrawerSlot() {
  const { open } = useDeveloperDrawer();
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <DeveloperViewerDrawer />
    </Suspense>
  );
}
