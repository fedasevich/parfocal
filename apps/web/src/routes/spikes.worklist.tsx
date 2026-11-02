import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { worklistRows } from "../screens/worklist-spike/rows.ts";
import { WorklistSpike } from "../screens/worklist-spike/worklist-spike.tsx";

const worklistSearch = z.object({
  rows: z.number().int().min(0).max(50_000).optional(),
  mode: z.enum(["virtual", "plain"]).optional(),
});

export const Route = createFileRoute("/spikes/worklist")({
  validateSearch: worklistSearch,
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: WorklistSpikePage,
});

function WorklistSpikePage() {
  const search = Route.useSearch();
  const count = search.rows ?? 10_000;
  const [data] = useState(() => worklistRows(count));
  return (
    <div className="h-dvh">
      <WorklistSpike data={data} mode={search.mode ?? "virtual"} />
    </div>
  );
}
