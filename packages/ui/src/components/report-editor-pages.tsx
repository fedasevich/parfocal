import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import {
  addBlock,
  type BlockKind,
  duplicateBlock,
  type EditorBlock,
  type FormatSettings,
  moveBlock,
  moveBlockTo,
  paginate,
  paperSize,
  removeBlock,
  sampleValue,
} from "@parfocal/ui/lib/report-editor-model";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

export const dragType = "application/x-parfocal-block";

export const filled = (text: string) =>
  text
    .replaceAll("{task}", "RT-14 · Round 2")
    .replaceAll("{model}", "CAMELYON")
    .replaceAll("{version}", "v1.0")
    .replaceAll("{slides}", "12 slides");

const metricLabel = (metric: string) =>
  ({
    sensitivity: "Sensitivity",
    precision: "Precision",
    dice: "Dice",
    kappa: "Cohen's κ",
    "cell-agreement": "Cells agreed",
  })[metric] ?? metric;

function SampleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[9px]">
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} className="border-b border-[#bbb] px-1 py-0.5 text-left font-semibold">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join("|")}>
            {row.map((cell, index) => (
              <td
                key={`${row[0]}-${head[index]}`}
                className="border-b border-[#e5e5e5] px-1 py-0.5"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SampleBars({ rows }: { rows: [string, number][] }) {
  return (
    <div className="grid gap-0.5 text-[9px]">
      {rows.map(([label, share]) => (
        <div key={label} className="grid grid-cols-[84px_minmax(0,1fr)_24px] items-center gap-1">
          <span>{label}</span>
          <span className="h-1.5 bg-[#e5e5e5]">
            <span className="block h-full bg-[#1d5fd1]" style={{ width: `${share}%` }} />
          </span>
          <span className="text-right">{share}%</span>
        </div>
      ))}
    </div>
  );
}

function SampleBody({ block, decimals }: { block: EditorBlock; decimals: number }) {
  const list = (key: string) => (Array.isArray(block[key]) ? (block[key] as string[]) : []);
  switch (block.kind) {
    case "headline-numbers":
      return (
        <div className="flex flex-wrap gap-1.5">
          {list("metrics").map((metric) => (
            <div key={metric} className="grid min-w-14 gap-0 border border-[#ccc] px-1.5 py-1">
              <b className="text-[12px]">{sampleValue(metric, decimals)}</b>
              <span className="text-[8px] text-[#555]">{metricLabel(metric)}</span>
            </div>
          ))}
        </div>
      );
    case "region-metrics": {
      const columns = list("columns");
      return (
        <SampleTable
          head={["Slide", ...columns.map(metricLabel)]}
          rows={["A1", "A2", "B1"].map((slide, index) => [
            slide,
            ...columns.map((metric) =>
              (Number(sampleValue(metric, decimals)) - index * 0.03).toFixed(decimals),
            ),
          ])}
        />
      );
    }
    case "confusion-matrix": {
      const share = block["values"] === "share";
      return (
        <SampleTable
          head={["AI said", "Tumor", "Inflammatory", "Other"]}
          rows={[
            ["Tumor", share ? "88%" : "412", share ? "8%" : "37", share ? "4%" : "19"],
            ["Inflammatory", share ? "9%" : "28", share ? "84%" : "261", share ? "7%" : "22"],
            ["Other", share ? "6%" : "11", share ? "5%" : "9", share ? "89%" : "140"],
          ]}
        />
      );
    }
    case "reviewer-agreement":
      return (
        <SampleTable
          head={["Agreement on", "Cohen's κ"]}
          rows={list("parts").map((part) => [
            part === "form" ? "Opinion form" : part === "cells" ? "Cells" : "Regions",
            sampleValue("kappa", decimals),
          ])}
        />
      );
    case "disagreement-reasons":
      return block["style"] === "table" ? (
        <SampleTable
          head={["Reason", "Share"]}
          rows={[
            ["Wrong class", "41%"],
            ["Wrong outline", "33%"],
            ["Not a nucleus", "26%"],
          ]}
        />
      ) : (
        <SampleBars
          rows={[
            ["Wrong class", 41],
            ["Wrong outline", 33],
            ["Not a nucleus", 26],
          ]}
        />
      );
    case "opinion-answers":
      return block["style"] === "table" ? (
        <SampleTable
          head={["Answer", "Share"]}
          rows={[
            ["Yes", "64%"],
            ["No", "22%"],
            ["Unsure", "14%"],
          ]}
        />
      ) : (
        <SampleBars
          rows={[
            ["Yes", 64],
            ["No", 22],
            ["Unsure", 14],
          ]}
        />
      );
    case "worst-objects":
      return (
        <SampleTable
          head={["Object", "Disagreed"]}
          rows={[
            ["T2·C145", "3 of 3"],
            ["T1·R12", "3 of 3"],
            ["T4·C88", "2 of 3"],
          ]}
        />
      );
    case "slide-table": {
      const columns = list("columns");
      const label = (column: string) =>
        column === "time" ? "Review time" : column === "objects" ? "Objects" : "Disagreements";
      const value = (column: string, index: number) =>
        column === "time"
          ? `${14 + index} min`
          : column === "objects"
            ? String(58 - index * 4)
            : String(9 - index * 2);
      return (
        <SampleTable
          head={["Slide", ...columns.map(label)]}
          rows={["A1", "A2", "B1"].map((slide, index) => [
            slide,
            ...columns.map((column) => value(column, index)),
          ])}
        />
      );
    }
    case "slide-figure":
      return (
        <div className="grid gap-0.5">
          <span className="grid h-14 place-items-center bg-[#efe9dc] text-[9px] text-[#555]">
            {list("layers")
              .map((layer) => (layer === "ai" ? "AI result" : "Reviewed layer"))
              .join(" + ")}
          </span>
          {typeof block["caption"] === "string" && block["caption"] ? (
            <span className="text-[9px] text-[#555]">{filled(block["caption"])}</span>
          ) : null}
        </div>
      );
    case "text":
      return (
        <p className="m-0 whitespace-pre-wrap text-[10px]">
          {typeof block["body"] === "string" && block["body"]
            ? filled(block["body"])
            : "Your text appears here."}
        </p>
      );
    case "comparison":
      return (
        <SampleTable
          head={["Metric", "RT-14", "RT-15"]}
          rows={list("metrics").map((metric) => [
            metricLabel(metric),
            sampleValue(metric, decimals),
            (Number(sampleValue(metric, decimals)) - 0.04).toFixed(decimals),
          ])}
        />
      );
    case "ai-changes":
      return (
        <SampleTable
          head={[block["group_by"] === "slide" ? "Slide" : "Class", "Kept", "Edited", "Deleted"]}
          rows={[
            ["Tumor", "331", "52", "29"],
            ["Inflammatory", "204", "31", "26"],
          ]}
        />
      );
  }
}

type PageViewProps = {
  title: string;
  blocks: EditorBlock[];
  format: FormatSettings;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onBlocksChange: (blocks: EditorBlock[]) => void;
  onSelectedChange: (id: string | null) => void;
};

function BlockToolbar({
  block,
  blocks,
  onBlocksChange,
  onSelectedChange,
}: {
  block: EditorBlock;
  blocks: EditorBlock[];
  onBlocksChange: (blocks: EditorBlock[]) => void;
  onSelectedChange: (id: string | null) => void;
}) {
  const index = blocks.findIndex((item) => item.id === block.id);
  return (
    <div
      role="toolbar"
      aria-label={`Tools for ${block.title}`}
      className="absolute -top-3 right-1 z-10 flex gap-0.5 rounded-ctl border border-line bg-chrome p-0.5 shadow-pop"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move up"
        disabled={index <= 0}
        onClick={() => onBlocksChange(moveBlock(blocks, block.id, -1))}
      >
        <Icon name="down" className="rotate-180" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move down"
        disabled={index >= blocks.length - 1}
        onClick={() => onBlocksChange(moveBlock(blocks, block.id, 1))}
      >
        <Icon name="down" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Duplicate"
        onClick={() => {
          const result = duplicateBlock(blocks, block.id);
          onBlocksChange(result.blocks);
          if (result.added) onSelectedChange(result.added.id);
        }}
      >
        <Icon name="layers" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Remove"
        onClick={() => {
          onBlocksChange(removeBlock(blocks, block.id));
          onSelectedChange(null);
        }}
      >
        <Icon name="close" />
      </Button>
    </div>
  );
}

export function ReportPages({
  title,
  blocks,
  format,
  selected,
  onSelect,
  onBlocksChange,
  onSelectedChange,
}: PageViewProps) {
  const [over, setOver] = React.useState<{ id: string; after: boolean } | "end" | null>(null);
  const size = paperSize(format);
  const pages = paginate(blocks);
  const textSize = { small: "9px", normal: "11px", large: "13px" }[format.text_size];
  const dropAt = (target: number, event: React.DragEvent) => {
    event.preventDefault();
    setOver(null);
    const raw = event.dataTransfer.getData(dragType);
    if (!raw) return;
    if (raw.startsWith("new:")) {
      const result = addBlock(blocks, raw.slice(4) as BlockKind, target);
      onBlocksChange(result.blocks);
      onSelectedChange(result.added.id);
    } else if (raw.startsWith("move:")) {
      onBlocksChange(moveBlockTo(blocks, raw.slice(5), target));
    }
  };
  const allowDrop = (event: React.DragEvent) => {
    if (Array.from(event.dataTransfer.types).includes(dragType)) event.preventDefault();
  };
  let position = -1;
  return (
    <div className="grid w-full justify-items-center gap-4">
      {pages.map((page, pageIndex) => (
        <section
          key={`${page.blocks[0]?.id ?? "empty"}-${pageIndex}`}
          aria-label={`Page ${pageIndex + 1} of ${pages.length}`}
          data-page={pageIndex + 1}
          className="relative grid w-full max-w-130 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-sm bg-white p-7 text-[#111] shadow-pop"
          style={{ aspectRatio: `${size.w} / ${size.h}`, fontSize: textSize }}
          onDragOver={
            pageIndex === pages.length - 1
              ? (event) => {
                  allowDrop(event);
                  if (event.target === event.currentTarget) setOver("end");
                }
              : undefined
          }
          onDrop={
            pageIndex === pages.length - 1 ? (event) => dropAt(blocks.length, event) : undefined
          }
        >
          {pageIndex === 0 ? (
            <div className="flex justify-between border-b-[1.5px] border-[#222] pb-2">
              <div className="grid">
                {format.logo ? <b className="text-[1.15em]">Parfocal</b> : null}
                <span className="text-[0.8em] text-[#555]">Sample project · sample numbers</span>
              </div>
              <div className="grid justify-items-end text-right">
                <b className="text-[1.15em]">{filled(format.title)}</b>
                <span className="text-[0.8em] text-[#555]">{filled(format.subtitle)}</span>
                <span className="sr-only">{title}</span>
              </div>
            </div>
          ) : format.running_header ? (
            <div className="flex justify-between border-b border-[#bbb] pb-1 text-[0.8em] text-[#555]">
              <span>{filled(format.title)}</span>
              <span>{filled(format.subtitle)}</span>
            </div>
          ) : (
            <span />
          )}
          <div className="grid min-h-0 grid-cols-2 content-start gap-x-2 gap-y-2 overflow-hidden">
            {page.blocks.map((block) => {
              position += 1;
              const at = position;
              const isSelected = selected === block.id;
              const marker = over !== null && over !== "end" && over.id === block.id ? over : null;
              return (
                <div
                  key={block.id}
                  role="group"
                  aria-label={`Block ${at + 1}, ${block.title}`}
                  data-block={block.id}
                  data-kind={block.kind}
                  className={cn(
                    "relative rounded-[3px] border border-dashed border-transparent",
                    block.width === "half" ? "col-span-1" : "col-span-2",
                    isSelected && "border-[#1d5fd1] bg-[#1d5fd1]/5",
                    marker?.after === false && "border-t-2 border-t-[#1d5fd1]",
                    marker?.after === true && "border-b-2 border-b-[#1d5fd1]",
                  )}
                  onDragOver={(event) => {
                    allowDrop(event);
                    const box = event.currentTarget.getBoundingClientRect();
                    setOver({ id: block.id, after: event.clientY > box.top + box.height / 2 });
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(event) => {
                    event.stopPropagation();
                    const box = event.currentTarget.getBoundingClientRect();
                    dropAt(event.clientY > box.top + box.height / 2 ? at + 1 : at, event);
                  }}
                >
                  {isSelected ? (
                    <BlockToolbar
                      block={block}
                      blocks={blocks}
                      onBlocksChange={onBlocksChange}
                      onSelectedChange={onSelectedChange}
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(dragType, `move:${block.id}`);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onSelect(block.id)}
                    onKeyDown={(event) => {
                      if (event.altKey && event.key === "ArrowUp") {
                        event.preventDefault();
                        onBlocksChange(moveBlock(blocks, block.id, -1));
                      }
                      if (event.altKey && event.key === "ArrowDown") {
                        event.preventDefault();
                        onBlocksChange(moveBlock(blocks, block.id, 1));
                      }
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        onBlocksChange(removeBlock(blocks, block.id));
                        onSelectedChange(null);
                      }
                    }}
                    className="grid w-full cursor-pointer gap-1 border-0 bg-transparent p-1.5 text-left text-inherit"
                  >
                    {block.show_title ? <b className="text-[1.1em]">{block.title}</b> : null}
                    <SampleBody block={block} decimals={format.decimals} />
                  </button>
                </div>
              );
            })}
            {page.blocks.length === 0 ? (
              <span
                className={cn(
                  "col-span-2 grid h-20 place-items-center rounded-[3px] border border-dashed border-[#999] text-[0.9em] text-[#555]",
                  over === "end" && "border-[#1d5fd1]",
                )}
              >
                An empty page. Drag a block here or click one on the left.
              </span>
            ) : null}
          </div>
          <div className="relative flex items-end justify-between text-[0.8em] text-[#555]">
            <span>
              {pageIndex === pages.length - 1 && format.signature
                ? "Signed off by: ____________  Date: ________"
                : "Sample · not a real evaluation"}
            </span>
            <span>
              {format.page_numbers === "none"
                ? ""
                : format.page_numbers === "page"
                  ? `${pageIndex + 1}`
                  : `Page ${pageIndex + 1} of ${pages.length}`}
            </span>
          </div>
          {format.draft_watermark ? (
            <i
              aria-hidden="true"
              data-slot="watermark"
              className="pointer-events-none absolute inset-0 grid place-items-center text-[64px] font-bold text-black/5 not-italic -rotate-30 after:content-['DRAFT']"
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
