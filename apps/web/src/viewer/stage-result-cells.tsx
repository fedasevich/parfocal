import { getGetCellSummaryUrl, type ResultSet, useListSlideResultSets } from "@parfocal/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { okData } from "../screens/placeholder.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { summaryCells } from "./stage-geometry.ts";
import { type CellSummary, readCellSummary, readPfc, type ViewerEngine } from "./viewer-engine.ts";

async function fetchSummary(setId: string): Promise<CellSummary> {
  const response = await fetch(getGetCellSummaryUrl(setId), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`cell summary answered ${response.status}`);
  return readCellSummary(readPfc(new Uint8Array(await response.arrayBuffer())));
}

function SetCells({
  engine,
  module,
  set,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  set: ResultSet;
}) {
  const summary = useQuery({
    queryKey: ["cell-summary", set.id],
    queryFn: () => fetchSummary(set.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: `result-cells-${set.id}`, host: engine }),
    [module, engine, set.id],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const cells = useMemo(
    () => (summary.data === undefined ? [] : summaryCells(set.id, summary.data)),
    [summary.data, set.id],
  );
  useEffect(() => {
    drawing.setChoices({ draw: "dots", colorBy: "score" });
    drawing.setObjects(cells);
  }, [drawing, cells]);
  return <div hidden data-testid="result-set-cells" data-set={set.id} data-cells={cells.length} />;
}

export function StageResultCells({
  engine,
  module,
  slideId,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  slideId: string;
}) {
  const sets = okData(useListSlideResultSets(slideId).data) ?? [];
  const withCells = sets.filter((set) => set.status === "ready" && (set.cell_count ?? 0) > 0);
  return (
    <>
      {withCells.map((set) => (
        <SetCells key={set.id} engine={engine} module={module} set={set} />
      ))}
    </>
  );
}
