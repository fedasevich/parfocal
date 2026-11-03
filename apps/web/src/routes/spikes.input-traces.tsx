import { createFileRoute, notFound } from "@tanstack/react-router";
import { InputTraces } from "../screens/input-traces/input-traces.tsx";

export const Route = createFileRoute("/spikes/input-traces")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: InputTraces,
});
