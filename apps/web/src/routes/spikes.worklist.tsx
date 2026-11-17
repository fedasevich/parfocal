import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { worklistRows } from "../screens/worklist-spike/rows.ts";
import { WorklistSpike } from "../screens/worklist-spike/worklist-spike.tsx";
import { worklistSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/spikes/worklist")({
  validateSearch: worklistSearch,
  beforeLoad: () => {
    if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS !== "on") throw notFound();
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
