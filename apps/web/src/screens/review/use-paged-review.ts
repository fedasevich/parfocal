import type { ReviewObject } from "@parfocal/api-client";
import type { Extent as ZoneExtent } from "@parfocal/ui/lib/unsure-zones";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readBuildConfig } from "../../config.ts";
import type { PagedCells } from "../../viewer/viewer-engine.ts";
import {
  distinctAlphas,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  fieldAround,
  idleProbe,
  type PagedProbe,
  type Point,
  pagedCountFrom,
  placeholderShapes,
  reviewObjectOf,
  slideExtent,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  WORKING_SET,
  windowShapes,
} from "./paged-review.ts";
import { type CellShape, replaceCellShapes, restoreCellShapes } from "./slide-geometry.ts";
import type { RegionStyle } from "./slide-still.tsx";

type EngineModule = typeof import("../../viewer/viewer-engine.ts");

type Opened = {
  engine: EngineModule;
  paged: PagedCells;
  extent: ZoneExtent;
  field: Point;
};

export type PagedReview = {
  cells: ReviewObject[];
  extent: ZoneExtent;
  positionOf: (object: string) => Point | undefined;
  styleOf: (object: string, base: RegionStyle | undefined) => RegionStyle | undefined;
  follow: (centre: Point | null) => void;
  probe: PagedProbe;
};

const noTops: ReadonlyMap<string, number> = new Map();

export function usePagedReview(classNames: readonly string[]): PagedReview | null {
  const count = useMemo(() => {
    if (typeof window === "undefined" || readBuildConfig().fakeApi === "off") return null;
    return pagedCountFrom(window.location.search);
  }, []);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [workingSet, setWorkingSet] = useState<ReviewObject[]>([]);
  const [probe, setProbe] = useState<PagedProbe>(idleProbe);
  const tops = useRef<ReadonlyMap<string, number>>(noTops);
  const base = useRef<Record<string, CellShape>>({});
  const baseTops = useRef<ReadonlyMap<string, number>>(noTops);
  const generation = useRef(0);
  const names = classNames.join("|");

  useEffect(() => {
    if (count === null) return;
    let closed = false;
    let live: PagedCells | null = null;
    void (async () => {
      const [engine, generator] = await Promise.all([
        import("../../viewer/viewer-engine.ts"),
        import("../../lab/paged-cell-source.ts"),
      ]);
      const paged = await engine.PagedCells.open(generator.pagedCellSource({ cells: count }));
      if (closed) {
        paged.close();
        return;
      }
      live = paged;
      const [, , right, bottom] = slideExtent(paged.summary);
      setOpened({
        engine,
        paged,
        extent: [0, 0, right, bottom],
        field: { x: right / 2, y: bottom / 2 },
      });
    })();
    return () => {
      closed = true;
      live?.close();
      restoreCellShapes();
      setOpened(null);
    };
  }, [count]);

  useEffect(() => {
    if (opened === null || names === "") return;
    const { paged, field, engine } = opened;
    const view = fieldAround(field, FIELD_WIDTH, FIELD_HEIGHT);
    const found = paged.unsureIn(view, WORKING_SET);
    const objects = found.map((cell) => reviewObjectOf(cell, names.split("|")));
    const shapes = placeholderShapes(found, paged);
    base.current = shapes;
    baseTops.current = new Map(found.map((cell) => [`C${cell.number}`, cell.confidence?.top ?? 1]));
    tops.current = baseTops.current;
    replaceCellShapes(shapes);
    setWorkingSet(objects);
    setProbe({
      ready: true,
      cells: paged.summary.count,
      paged: paged.paged,
      resident: 0,
      drawn: 0,
      distinctAlphas: distinctAlphas(tops.current, engine.fadeAlpha),
      workingSet: objects.length,
    });
  }, [opened, names]);

  const follow = useCallback(
    (centre: Point | null) => {
      if (opened === null || baseTops.current === noTops) return;
      const { paged, engine, field } = opened;
      const ticket = ++generation.current;
      const view = fieldAround(centre ?? field, WINDOW_WIDTH, WINDOW_HEIGHT);
      void paged.show(view).then((report) => {
        if (report.superseded || ticket !== generation.current) return;
        const built = windowShapes(
          paged,
          engine.confidenceOf,
          view,
          base.current,
          baseTops.current,
        );
        tops.current = built.tops;
        replaceCellShapes(built.shapes);
        const stats = paged.stats();
        setProbe((before) => ({
          ...before,
          resident: stats.residentCells,
          drawn: built.drawn,
          distinctAlphas: distinctAlphas(built.tops, engine.fadeAlpha),
        }));
      });
    },
    [opened],
  );

  const styleOf = useCallback(
    (object: string, style: RegionStyle | undefined): RegionStyle | undefined => {
      const top = tops.current.get(object);
      if (top === undefined || opened === null) return style;
      return {
        stroke: "var(--c-tumor)",
        ...style,
        opacity: (style?.opacity ?? 1) * opened.engine.fadeAlpha(top),
      };
    },
    [opened],
  );

  const positionOf = useCallback((object: string): Point | undefined => base.current[object], []);

  if (count === null) return null;
  return {
    cells: workingSet,
    extent: opened?.extent ?? [0, 0, 1, 1],
    positionOf,
    styleOf,
    follow,
    probe,
  };
}
