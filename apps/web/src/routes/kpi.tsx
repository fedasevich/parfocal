import { createFileRoute } from "@tanstack/react-router";
import { KpiScreen } from "../screens/kpi/kpi-screen.tsx";

export const Route = createFileRoute("/kpi")({
  component: KpiScreen,
});
