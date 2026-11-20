import { Trans, useLingui } from "@lingui/react/macro";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useMemo, useRef } from "react";
import type { AnnotationDocument } from "../annotations/document.ts";
import type { ShapeId } from "../annotations/shapes.ts";
import { useDocked } from "../viewer/inspector-slots.tsx";
import { useRulersClaimed } from "../viewer/stage-measurements.tsx";
import { useLengthUnits } from "./length-units.ts";
import {
  buildMeasurementRows,
  formatDrawnTime,
  groupMeasurementRows,
  type MeasurementGroup,
  type MeasurementNames,
  noClass,
  noteDrawnTimes,
  unknownClass,
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
  const skipRulers = useRulersClaimed();
  const { t } = useLingui();
  const groupName = (group: MeasurementGroup) => {
    if (group.kind === "ruler") return t`Rulers`;
    if (group.name === noClass) return t`No class`;
    return group.name === unknownClass ? t`Unknown class` : group.name;
  };
  const docked = useDocked();

  const times = useRef<ReadonlyMap<ShapeId, number>>(new Map());
  times.current = noteDrawnTimes(times.current, doc, Date.now());
  const drawn = times.current;
  const units = useLengthUnits();
  const rows = useMemo(
    () =>
      buildMeasurementRows(doc, micronsPerPixel, drawn, classNames, units).filter(
        (row) => !skipRulers || row.kind !== "ruler",
      ),
    [doc, micronsPerPixel, drawn, classNames, units, skipRulers],
  );
  if (skipRulers && rows.length === 0) return null;

  return (
    <section
      aria-label={t`Measurements`}
      data-testid="measurement-list"
      className={
        docked
          ? "grid gap-1.5 rounded-zone border border-surf-edge bg-surf-section p-3"
          : "grid gap-1.5 rounded-ctl border border-line bg-chrome p-2"
      }
    >
      <h2 className="m-0 text-body-sm font-semibold">
        <Trans>
          Measurements <span className="font-mono text-fg-dim">{rows.length}</span>
        </Trans>
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>Nothing measured yet. Press L and drag to measure a length.</Trans>
        </p>
      ) : (
        <div className="grid gap-2">
          {groupMeasurementRows(rows).map((group) => {
            const name = groupName(group);
            return (
              <section
                key={`${group.kind}:${group.name}`}
                aria-label={name}
                data-testid="measurement-group"
                data-group={group.name}
                className="grid gap-1"
              >
                <h3 className="m-0 text-caption font-semibold text-fg-dim">
                  {name} <span className="font-mono">{group.rows.length}</span>
                </h3>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {group.rows.map((row) => (
                    <li
                      key={row.shapeId}
                      data-testid="measurement-row"
                      data-kind={row.kind}
                      className="flex items-center gap-2 text-body-sm"
                    >
                      <ObjectIdTag>{row.label}</ObjectIdTag>
                      <span className="grid shrink-0 whitespace-nowrap">
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
                              <Trans>perimeter {row.value}</Trans>
                            </small>
                          </>
                        )}
                      </span>
                      <time
                        data-slot="time"
                        className="ml-auto font-mono text-caption whitespace-nowrap text-fg-dim"
                      >
                        {formatDrawnTime(row.drawnAt)}
                      </time>
                      {onRemove === undefined ? null : (
                        <button
                          type="button"
                          aria-label={t`Remove ${row.label}`}
                          className="text-fg-dim hover:text-fg"
                          onClick={() => onRemove(row.shapeId)}
                        >
                          <Trans>Remove</Trans>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
