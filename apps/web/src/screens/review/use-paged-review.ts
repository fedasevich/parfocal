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
import { buildUnsureIndex } from "./unsure-index.ts";
import { FOLLOW_LIMIT, fieldCentreOf, fieldKeyOf, WorkingSet } from "./working-set.ts";

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
  pin: (objects: Iterable<string>) => void;
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

  const set = useRef(new WorkingSet());
  const initialKey = "initial";

  const commit = useCallback(
    (loaded: Opened, indexed: boolean) => {
      const cells = set.current.cells();
      const shapes = placeholderShapes(cells, loaded.paged);
      base.current = shapes;
      baseTops.current = new Map(
        cells.map((cell) => [`C${cell.number}`, cell.confidence?.top ?? 1]),
      );
      tops.current = baseTops.current;
      replaceCellShapes(shapes);
      setWorkingSet(cells.map((cell) => reviewObjectOf(cell, names.split("|"))));
      setProbe((before) => ({
        ...before,
        ready: true,
        cells: loaded.paged.summary.count,
        paged: loaded.paged.paged,
        distinctAlphas: distinctAlphas(tops.current, loaded.engine.fadeAlpha),
        workingSet: cells.length,
        indexed: indexed ? set.current.indexSize() : before.indexed,
        fields: before.fields,
      }));
    },
    [names],
  );

  useEffect(() => {
    if (opened === null || names === "") return;
    const { paged, field } = opened;
    set.current = new WorkingSet();
    set.current.addField(
      initialKey,
      paged.unsureIn(fieldAround(field, FIELD_WIDTH, FIELD_HEIGHT), WORKING_SET),
    );
    commit(opened, false);
    let stopped = false;
    void buildUnsureIndex(
      paged,
      { isUnsureCell: opened.engine.isUnsureCell, numberOfRow: opened.engine.numberOfRow },
      () => stopped,
    ).then((cells) => {
      if (stopped) return;
      set.current.setIndex(cells);
      commit(opened, true);
    });
    return () => {
      stopped = true;
    };
  }, [opened, names, commit]);

  const follow = useCallback(
    (centre: Point | null) => {
      if (opened === null || baseTops.current === noTops) return;
      const { paged, engine, field } = opened;
      const ticket = ++generation.current;
      const key = centre === null ? initialKey : fieldKeyOf(centre);
      if (set.current.hasField(key)) set.current.touch(key);
      else {
        const around = fieldCentreOf(key);
        set.current.addField(
          key,
          paged.unsureIn(fieldAround(around, FIELD_WIDTH, FIELD_HEIGHT), FOLLOW_LIMIT),
        );
        commit(opened, false);
        setProbe((before) => ({ ...before, fields: before.fields + 1 }));
      }
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
    [opened, commit],
  );

  const pin = useCallback((objects: Iterable<string>) => set.current.pin(objects), []);

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
    pin,
    probe,
  };
}
