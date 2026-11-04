import type { ProjectClass } from "@parfocal/api-client";
import { countByClass, unclassedKey } from "./count-markers.ts";
import type { AnnotationDocument } from "./document.ts";

type CountPanelProps = {
  document: AnnotationDocument;
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string | null) => void;
};

export function CountPanel({ document: doc, classes, activeClass, onPick }: CountPanelProps) {
  const counts = countByClass(doc, [...classes.map((item) => item.id), unclassedKey]);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const rows = counts.filter(
    (row) => row.classKey !== unclassedKey || row.count > 0 || classes.length === 0,
  );
  return (
    <section
      aria-label="Counts"
      data-testid="count-panel"
      data-total={total}
      className="grid gap-1.5 rounded-ctl border border-line bg-chrome p-2"
    >
      <h2 className="m-0 text-body-sm font-semibold">
        Counts <span className="font-mono text-fg-dim">{total}</span>
      </h2>
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((row, index) => {
          const info = classes.find((item) => item.id === row.classKey);
          const key = row.classKey === unclassedKey ? null : row.classKey;
          return (
            <li key={row.classKey} className="contents">
              <button
                type="button"
                data-testid="count-row"
                data-class={row.classKey}
                data-count={row.count}
                aria-pressed={activeClass === key}
                onClick={() => onPick(key)}
                className="flex items-center gap-2 rounded-ctl px-1.5 py-1 text-left text-body-sm aria-pressed:bg-accent/15"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: info?.colour ?? "var(--color-accent)" }}
                />
                <span className="flex-1">{info?.name ?? "Marker"}</span>
                {index < 9 && info ? (
                  <kbd className="font-mono text-fg-dim">{index + 1}</kbd>
                ) : null}
                <span className="font-mono">{row.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-body-sm text-fg-dim">
        Click to drop a marker. Shift-click removes one.
      </p>
    </section>
  );
}
