import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ReportSheetProps = React.ComponentProps<"article"> & {
  page: number;
  pages: number;
  footer?: React.ReactNode;
};

function ReportSheet({ page, pages, footer, className, children, ...props }: ReportSheetProps) {
  return (
    <article
      data-slot="report-sheet"
      aria-label={`Page ${page} of ${pages}`}
      className={cn(
        "flex aspect-[210/297] w-155 shrink-0 flex-col gap-5 bg-white px-11 pt-9 pb-6 text-[10px] leading-[1.4] text-[#111] shadow-pop",
        className,
      )}
      {...props}
    >
      <div className="grid min-h-0 flex-1 content-start gap-5">{children}</div>
      <div className="flex justify-between text-[8px] text-[#6b6b6b]">
        <span>{footer}</span>
        <span>
          Page {page} of {pages}
        </span>
      </div>
    </article>
  );
}

type ReportLetterheadProps = React.ComponentProps<"header"> & {
  lab: { name: string; short: string };
  kind: string;
  title: string;
  lines: string[];
};

function ReportLetterhead({ lab, kind, title, lines, className, ...props }: ReportLetterheadProps) {
  return (
    <header
      data-slot="report-letterhead"
      className={cn(
        "flex items-start justify-between gap-6 border-b-[1.5px] border-[#222] pb-3.5",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-[5px] bg-[#0f766e] text-[9px] font-bold text-white">
          {lab.short}
        </span>
        <span className="grid">
          <b className="text-[11px]">{lab.name}</b>
          <span className="text-[8px] text-[#555]">{kind}</span>
        </span>
      </div>
      <div className="grid justify-items-end text-right">
        <b className="text-[15px]">{title}</b>
        {lines.map((line) => (
          <span key={line} className="text-[8px] text-[#555]">
            {line}
          </span>
        ))}
      </div>
    </header>
  );
}

type ReportFactsProps = React.ComponentProps<"dl"> & {
  facts: { label: string; value: React.ReactNode }[];
};

function ReportFacts({ facts, className, ...props }: ReportFactsProps) {
  return (
    <dl
      data-slot="report-facts"
      className={cn(
        "m-0 grid grid-cols-3 gap-x-4 gap-y-2.5 border-b border-[#ccc] pb-3.5",
        className,
      )}
      {...props}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="grid gap-0.5">
          <dt className="text-[7.5px] text-[#666]">{fact.label}</dt>
          <dd className="m-0 font-semibold">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type ReportBlockProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode;
  half?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

function ReportBlock({
  title,
  half = false,
  selected = false,
  onSelect,
  className,
  children,
  ...props
}: ReportBlockProps) {
  return (
    <section
      data-slot="report-block"
      data-selected={selected || undefined}
      className={cn(
        "relative grid content-start gap-2 rounded-[3px] outline-offset-4",
        half ? "col-span-1" : "col-span-2",
        onSelect && "hover:outline-1 hover:outline-dashed hover:outline-[#1a56be]/50",
        selected && "outline-2 outline-[#1a56be]",
        className,
      )}
      {...props}
    >
      <h3 className="m-0 text-[9px] font-bold">{title}</h3>
      {children}
      {onSelect ? (
        <button
          type="button"
          aria-label={`Select the block ${typeof title === "string" ? title : ""}`.trim()}
          aria-pressed={selected}
          onClick={onSelect}
          className="absolute -inset-1 cursor-pointer border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-[#1a56be]"
        />
      ) : null}
    </section>
  );
}

function ReportBlocks({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="report-blocks"
      className={cn("grid grid-cols-2 content-start gap-x-6 gap-y-6", className)}
      {...props}
    />
  );
}

type MetricTilesProps = React.ComponentProps<"div"> & {
  tiles: { value: string; label: string }[];
  variant?: "paper" | "panel";
};

function MetricTiles({ tiles, variant = "paper", className, ...props }: MetricTilesProps) {
  return (
    <div
      data-slot="metric-tiles"
      data-variant={variant}
      className={cn(
        "grid gap-2",
        variant === "paper" ? "grid-cols-5" : "grid-cols-5 gap-4",
        className,
      )}
      {...props}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cn(
            "grid content-start gap-1",
            variant === "paper" && "rounded-[3px] border border-[#ccc] px-2 py-1.5",
          )}
        >
          <b
            className={cn(
              "font-mono font-semibold",
              variant === "paper" ? "text-[17px]" : "text-[22px] text-fg",
            )}
          >
            {tile.value}
          </b>
          <small
            className={cn(
              variant === "paper" ? "text-[7.5px] text-[#555]" : "text-caption text-fg",
            )}
          >
            {tile.label}
          </small>
        </div>
      ))}
    </div>
  );
}

type ConfusionMatrixProps = React.ComponentProps<"figure"> & {
  classes: string[];
  counts: number[][];
  caption?: React.ReactNode;
};

function ConfusionMatrix({ classes, counts, caption, className, ...props }: ConfusionMatrixProps) {
  const max = Math.max(1, ...counts.flat());
  return (
    <figure data-slot="confusion-matrix" className={cn("m-0 grid gap-2", className)} {...props}>
      <table className="w-fit border-separate border-spacing-0.5 text-[8.5px]">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">The AI said</span>
            </th>
            {classes.map((name) => (
              <th key={name} scope="col" className="w-12 pb-0.5 font-normal text-[#444]">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((name, row) => (
            <tr key={name}>
              <th scope="row" className="pr-1.5 text-right font-normal text-[#444]">
                {name}
              </th>
              {classes.map((column, index) => {
                const value = counts[row]?.[index] ?? 0;
                const diagonal = row === index;
                return (
                  <td
                    key={column}
                    className={cn("h-5 text-center", diagonal && "font-bold")}
                    style={{
                      background: diagonal
                        ? `rgba(29, 95, 209, ${(0.25 + (0.45 * value) / max).toFixed(2)})`
                        : "#eef3fb",
                    }}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {caption ? <figcaption className="text-[7.5px] text-[#666]">{caption}</figcaption> : null}
    </figure>
  );
}

type CountBarsProps = React.ComponentProps<"div"> & {
  heading?: React.ReactNode;
  rows: { label: string; count: number }[];
};

function CountBars({ heading, rows, className, ...props }: CountBarsProps) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div data-slot="count-bars" className={cn("grid gap-1.5", className)} {...props}>
      {heading ? <b className="text-[9px] font-semibold">{heading}</b> : null}
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[96px_minmax(0,1fr)_22px] items-center gap-2"
        >
          <span className="truncate">{row.label}</span>
          <span className="h-1.75 bg-[#e6e6e6]">
            <span
              className="block h-full bg-[#1d5fd1]"
              style={{ width: `${(100 * row.count) / max}%` }}
            />
          </span>
          <span className="text-right font-mono">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

const answerColour = { agree: "#1f7a3a", disagree: "#b42318", unsure: "#9a6400" };

type ReportObjectsTableProps = React.ComponentProps<"table"> & {
  people: string[];
  rows: {
    object: string;
    what: string;
    answers: ("agree" | "disagree" | "unsure")[];
    thumb?: string;
  }[];
};

function ReportObjectsTable({ people, rows, className, ...props }: ReportObjectsTableProps) {
  return (
    <table
      data-slot="report-objects-table"
      className={cn("w-full border-collapse text-[8.5px]", className)}
      {...props}
    >
      <thead>
        <tr className="border-b border-[#222] text-left [&>th]:pb-1 [&>th]:font-semibold">
          <th scope="col" className="w-12">
            <span className="sr-only">Crop</span>
          </th>
          <th scope="col">ID</th>
          <th scope="col">Object</th>
          {people.map((name) => (
            <th key={name} scope="col">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.object} className="border-b border-[#ddd] [&>td]:py-1">
            <td>
              {row.thumb ? (
                <span
                  aria-hidden="true"
                  className="block h-3.5 w-6 bg-cover bg-center"
                  style={{ backgroundImage: `url(${row.thumb})` }}
                />
              ) : null}
            </td>
            <td className="font-mono font-semibold">{row.object}</td>
            <td>{row.what}</td>
            {row.answers.map((answer, index) => (
              <td
                key={`${people[index] ?? index}`}
                className="font-semibold"
                style={{ color: answerColour[answer] }}
              >
                {answer === "unsure" ? "unsure" : answer}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export {
  ConfusionMatrix,
  type ConfusionMatrixProps,
  CountBars,
  type CountBarsProps,
  MetricTiles,
  type MetricTilesProps,
  ReportBlock,
  type ReportBlockProps,
  ReportBlocks,
  ReportFacts,
  type ReportFactsProps,
  ReportLetterhead,
  type ReportLetterheadProps,
  ReportObjectsTable,
  type ReportObjectsTableProps,
  ReportSheet,
  type ReportSheetProps,
};
