import { CategoryTag, ObjectIdTag } from "@parfocal/ui/components/tag";
import { useMemo, useRef } from "react";
import type { AnnotationDocument } from "../annotations/document.ts";
import type { ShapeId } from "../annotations/shapes.ts";
import { useLengthUnits } from "./length-units.ts";
import {
  buildMeasurementRows,
  formatDrawnTime,
  type MeasurementNames,
  noteDrawnTimes,
} from "./measurement-list.ts";

export function MeasurementList({
  document: doc,
  micronsPerPixel,
  classNames,
  onRemove,
}: {
  document: AnnotationDocument;
  micronsPerPixel: number | null;
  classNames?: MeasurementNames;
  onRemove?: (id: ShapeId) => void;
}) {
  const times = useRef<ReadonlyMap<ShapeId, number>>(new Map());
  times.current = noteDrawnTimes(times.current, doc, Date.now());
  const drawn = times.current;
  const units = useLengthUnits();
  const rows = useMemo(
    () => buildMeasurementRows(doc, micronsPerPixel, drawn, classNames, units),
    [doc, micronsPerPixel, drawn, classNames, units],
  );

  return (
    <section
      aria-label="Measurements"
      data-testid="measurement-list"
      className="grid gap-1.5 rounded-ctl border border-line bg-chrome p-2"
    >
      <h2 className="m-0 text-body-sm font-semibold">
        Measurements <span className="font-mono text-fg-dim">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          Nothing measured yet. Press L and drag to measure a length.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {rows.map((row) => (
            <li
              key={row.shapeId}
              data-testid="measurement-row"
              data-kind={row.kind}
              className="flex items-center gap-2 text-body-sm"
            >
              <ObjectIdTag>{row.label}</ObjectIdTag>
              <span className="grid">
                {row.area === null ? (
                  <span data-slot="value" className="font-mono">
                    {row.value}
                  </span>
                ) : (
                  <>
                    <span data-slot="area" className="font-mono">
                      {row.area}
                    </span>
                    <small data-slot="value" className="font-mono text-caption text-fg-dim">
                      perimeter {row.value}
                    </small>
                  </>
                )}
              </span>
              <CategoryTag>{row.category}</CategoryTag>
              <time data-slot="time" className="ml-auto font-mono text-caption text-fg-dim">
                {formatDrawnTime(row.drawnAt)}
              </time>
              {onRemove === undefined ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${row.label}`}
                  className="text-fg-dim hover:text-fg"
                  onClick={() => onRemove(row.shapeId)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
