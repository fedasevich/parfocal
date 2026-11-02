import { createFileRoute, notFound } from "@tanstack/react-router";
import { HotkeysSpike } from "../screens/hotkeys-spike/hotkeys-spike.tsx";

export const Route = createFileRoute("/spikes/hotkeys")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: HotkeysSpike,
});
