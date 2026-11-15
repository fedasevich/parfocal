import { createFileRoute, notFound } from "@tanstack/react-router";
import { HotkeysSpike } from "../screens/hotkeys-spike/hotkeys-spike.tsx";

export const Route = createFileRoute("/spikes/hotkeys")({
  beforeLoad: () => {
    if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS !== "on") throw notFound();
  },
  component: HotkeysSpike,
});
