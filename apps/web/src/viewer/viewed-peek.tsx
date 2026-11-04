import { WholeSlidePeek } from "@parfocal/ui/components/smart-minimap";
import { useEffect, useMemo } from "react";
import { runCells, seenRuns } from "./seen-runs.ts";
import type { CoverageRaster, ViewerEngine } from "./viewer-engine.ts";

const jumpCells = 12;
const blankSlide = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

export function ViewedPeek({
  engine,
  raster,
  percent,
  onClose,
}: {
  engine: ViewerEngine;
  raster: CoverageRaster;
  percent: number;
  onClose: () => void;
}) {
  const { cell, columns, rows } = raster.grid;
  const runs = useMemo(() => seenRuns(raster), [raster]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const image = { src: blankSlide, width: columns * cell, height: rows * cell };
  return (
    <WholeSlidePeek
      data-testid="viewed-peek"
      image={image}
      sub={`${percent}% of the tissue seen at 10x or more`}
      onClose={onClose}
      onPick={([x, y]) => {
        const size = jumpCells * cell;
        void engine.flyToArea({ x: x - size / 2, y: y - size / 2, width: size, height: size });
        onClose();
      }}
    >
      <g
        data-slot="viewed-cells"
        data-cells={runCells(runs)}
        fill="var(--accent)"
        fillOpacity={0.35}
      >
        {runs.map((run) => (
          <rect
            key={`${run.row}:${run.start}`}
            x={run.start * cell}
            y={run.row * cell}
            width={run.length * cell}
            height={cell}
          />
        ))}
      </g>
    </WholeSlidePeek>
  );
}
