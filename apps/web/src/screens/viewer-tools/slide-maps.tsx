import { MapArea, PeekArea } from "@parfocal/ui/components/smart-minimap";
import { regionShapes } from "../review/slide-geometry.ts";
import { boxCentre } from "./tool-maths.ts";

export type AreaMark = { object: string; size: number };

export function MinimapAreas({
  areas,
  checked,
  current,
}: {
  areas: AreaMark[];
  checked: string[];
  current?: string | undefined;
}) {
  return (
    <>
      {areas.map((area, index) => {
        const shape = regionShapes[area.object];
        if (shape === undefined) return null;
        return (
          <MapArea
            key={area.object}
            path={shape.path}
            centre={boxCentre(shape.box)}
            label={String(index + 1)}
            badge={
              area.size < 1
                ? "none"
                : checked.includes(area.object)
                  ? "checked"
                  : area.object === current
                    ? "current"
                    : "open"
            }
          />
        );
      })}
    </>
  );
}

export function PeekAreas({ areas, checked }: { areas: AreaMark[]; checked: string[] }) {
  return (
    <>
      {areas.map((area, index) => {
        const shape = regionShapes[area.object];
        if (shape === undefined || area.size < 1) return null;
        return (
          <PeekArea
            key={area.object}
            path={shape.path}
            corner={[shape.box[2], shape.box[1]]}
            label={String(index + 1)}
            checked={checked.includes(area.object)}
          />
        );
      })}
    </>
  );
}

export {
  areaExtent,
  boxCentre,
  type Size,
  toOverview,
  toScreen,
  viewportOf,
} from "./tool-maths.ts";
