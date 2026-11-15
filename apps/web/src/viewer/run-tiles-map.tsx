import { useLingui } from "@lingui/react/macro";
import type { RunStreamState } from "./use-run-stream.ts";

const mapWidth = 96;

export function RunTilesMap({
  tiles,
  slide,
}: {
  readonly tiles: RunStreamState["tiles"];
  readonly slide: { readonly width: number; readonly height: number } | null;
}) {
  const { t } = useLingui();
  if (slide === null || slide.width <= 0 || slide.height <= 0) return null;
  const height = Math.max(1, Math.round((mapWidth * slide.height) / slide.width));
  return (
    <svg
      role="img"
      aria-label={t`Finished tiles`}
      data-testid="run-tiles-map"
      data-tiles={tiles.length}
      width={mapWidth}
      height={height}
      viewBox={`0 0 ${slide.width} ${slide.height}`}
      className="shrink-0 rounded-sm border border-line bg-chrome-2"
    >
      {tiles.map(([left, top, right, bottom]) => (
        <rect
          key={`${left}:${top}`}
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          className="fill-accent opacity-60"
        />
      ))}
    </svg>
  );
}
