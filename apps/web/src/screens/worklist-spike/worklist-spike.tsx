import { Person } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import {
  type Cell,
  createColumnHelper,
  type Row,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { movedIndex, type WorklistRow } from "./rows.ts";

export type WorklistMode = "virtual" | "plain";

const rowHeight = 44;
const headerHeight = 36;
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, WorklistRow>();
const columns = helper.columns([
  helper.accessor("slide", {
    header: "Slide",
    cell: (info) => (
      <span className="inline-flex min-w-0 items-center gap-2.25">
        <i
          aria-hidden="true"
          className="block h-5.5 w-8.5 shrink-0 rounded-md border border-line bg-chrome-3"
        />
        <b className="truncate font-medium text-fg">{info.getValue()}</b>
      </span>
    ),
  }),
  helper.accessor("project", {
    header: "Project",
    cell: (info) => (
      <span className="truncate text-fg-dim">
        {info.getValue()} · {info.row.original.caseLabel}
      </span>
    ),
  }),
  helper.accessor("resultSets", {
    header: "Result sets",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="text-fg">{info.getValue()}</span>
      ) : (
        <span className="text-fg-dim">none</span>
      ),
  }),
  helper.accessor("reviewer", {
    header: "Reviews",
    cell: (info) => (
      <Person person={info.getValue()} size={22} sub={info.row.original.reviewState} />
    ),
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusTag tone={info.getValue().tone}>{info.getValue().word}</StatusTag>,
  }),
  helper.accessor("due", {
    header: "Due",
    cell: (info) => <span className="text-fg-dim">{info.getValue()}</span>,
  }),
]);

const gridColumns =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_88px_minmax(0,1.6fr)_120px_64px] items-center";

type WorklistTable = ReturnType<typeof useWorklistTable>;

function useWorklistTable(data: WorklistRow[]) {
  return useTable({ features, columns, data });
}

const rowDomId = (index: number) => `worklist-row-${index}`;

function WorklistLine({
  table,
  row,
  index,
  active,
  top,
}: {
  table: WorklistTable;
  row: Row<typeof features, WorklistRow>;
  index: number;
  active: boolean;
  top?: number;
}) {
  return (
    <tr
      id={rowDomId(index)}
      aria-rowindex={index + 2}
      aria-selected={active}
      data-index={index}
      style={
        top === undefined
          ? { height: rowHeight }
          : {
              height: rowHeight,
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
      className={`${gridColumns} border-line border-b px-2 text-body-sm ${active ? "bg-accent-soft" : ""}`}
    >
      {row.getAllCells().map((cell: Cell<typeof features, WorklistRow, unknown>) => (
        <td key={cell.id} className="min-w-0 px-2">
          <table.FlexRender cell={cell} />
        </td>
      ))}
    </tr>
  );
}

export function WorklistSpike({ data, mode }: { data: WorklistRow[]; mode: WorklistMode }) {
  const table = useWorklistTable(data);
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const virtualizer = useVirtualizer({
    count: mode === "virtual" ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 10,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const next = movedIndex(active, event.key, rows.length);
      if (next === undefined) return;
      event.preventDefault();
      setActive(next);
      if (mode === "virtual") virtualizer.scrollToIndex(next, { align: "auto" });
      else document.getElementById(rowDomId(next))?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, rows.length, mode, virtualizer]);

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <p className="mb-2 text-caption text-fg-dim">
        {rows.length.toLocaleString("en-GB")} rows, {mode}. J and K move, Home and End jump.
      </p>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto rounded-md border border-line"
      >
        <table
          aria-label="Worklist"
          aria-rowcount={rows.length + 1}
          data-active-index={active}
          className="grid w-full"
        >
          <thead className="sticky top-0 z-10 grid bg-chrome-1">
            <tr
              aria-rowindex={1}
              style={{ height: headerHeight }}
              className={`${gridColumns} border-line-strong border-b px-2 text-left text-caption text-fg-dim`}
            >
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th key={header.id} className="px-2 font-semibold">
                  <table.FlexRender header={header} />
                </th>
              ))}
            </tr>
          </thead>
          {mode === "virtual" ? (
            <tbody
              className="grid"
              style={{ height: virtualizer.getTotalSize(), position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                return (
                  <WorklistLine
                    key={row.id}
                    table={table}
                    row={row}
                    index={item.index}
                    active={item.index === active}
                    top={item.start - headerHeight}
                  />
                );
              })}
            </tbody>
          ) : (
            <tbody className="grid">
              {rows.map((row, index) => (
                <WorklistLine
                  key={row.id}
                  table={table}
                  row={row}
                  index={index}
                  active={index === active}
                />
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
