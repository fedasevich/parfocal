import type { SlideArea } from "@parfocal/viewer-engine";

export type SlideAreaEntry = {
  readonly object: string;
  readonly size: number;
  readonly bounds: SlideArea;
};

const devSlideAreas: readonly SlideAreaEntry[] = [
  { object: "T1", size: 6.2, bounds: { x: 0, y: 0, width: 1024, height: 768 } },
  { object: "T2", size: 1.6, bounds: { x: 600, y: 200, width: 80, height: 60 } },
  { object: "T3", size: 0.15, bounds: { x: 200, y: 500, width: 48, height: 36 } },
];

export function slideAreasFor(fakeApi: boolean): readonly SlideAreaEntry[] {
  return fakeApi ? devSlideAreas : [];
}
