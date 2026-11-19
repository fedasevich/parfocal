import { createFileRoute, notFound } from "@tanstack/react-router";
import { KpiScreen } from "../screens/kpi/kpi-screen.tsx";

export const Route = createFileRoute("/kpi")({
  beforeLoad: () => {
    if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS !== "on") throw notFound();
  },
  component: KpiScreen,
});
