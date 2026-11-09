import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Switch } from "@parfocal/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { Textarea } from "@parfocal/ui/components/textarea";
import {
  addBlock,
  appendixOptions,
  type BlockField,
  type BlockKind,
  blockCopy,
  blockFields,
  blockKinds,
  downloadOptions,
  duplicateBlock,
  type EditorBlock,
  type FormatSettings,
  fieldValueText,
  insertionIndex,
  moveBlock,
  moveBlockTo,
  paginate,
  paperSize,
  removeBlock,
  sampleValue,
  selectedValue,
  setBlockField,
  toggleIn,
} from "@parfocal/ui/lib/report-editor-model";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

const dragType = "application/x-parfocal-block";

const filled = (text: string) =>
  text
    .replaceAll("{task}", "RT-14 · Round 2")
    .replaceAll("{model}", "CAMELYON")
    .replaceAll("{version}", "v1.0")
    .replaceAll("{slides}", "12 slides");

const inputClass =
  "min-h-8 w-full rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]";

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

function ReportPages({
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

function FieldLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span id={id} className="text-body-sm font-semibold">
      {children}
    </span>
  );
}

function BlockFieldControl({
  field,
  block,
  onChange,
}: {
  field: BlockField;
  block: EditorBlock;
  onChange: (value: unknown) => void;
}) {
  const labelId = `${block.id}-${field.key}`;
  if (field.kind === "toggle") {
    return (
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={labelId} className="font-semibold">
          {field.label}
        </span>
        <Switch
          aria-labelledby={labelId}
          checked={block[field.key] === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }
  if (field.kind === "checks") {
    const current = Array.isArray(block[field.key]) ? (block[field.key] as string[]) : [];
    const order = field.options.map((option) => option.value);
    return (
      <div role="group" aria-labelledby={labelId} className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        {field.options.map((option) => (
          <div key={option.value} className="flex items-center gap-2 text-body-sm">
            <Checkbox
              aria-label={option.label}
              checked={current.includes(option.value)}
              onCheckedChange={() =>
                onChange(toggleIn(current, option.value, order, field.keepOne))
              }
            />
            <span aria-hidden="true">{option.label}</span>
          </div>
        ))}
      </div>
    );
  }
  if (field.kind === "segment") {
    return (
      <div className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <SegmentedControl
          aria-labelledby={labelId}
          value={fieldValueText(field, block)}
          onValueChange={(value) => onChange(selectedValue(field, String(value)))}
          options={field.options}
        />
      </div>
    );
  }
  if (field.kind === "select") {
    const value = fieldValueText(field, block);
    return (
      <div className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <Select
          value={value}
          onValueChange={(next) => onChange(selectedValue(field, String(next)))}
        >
          <SelectTrigger aria-label={field.label} className="w-full">
            <SelectValue>
              {field.options.find((option) => option.value === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <FieldLabel id={labelId}>{field.label}</FieldLabel>
      <Textarea
        aria-labelledby={labelId}
        rows={field.rows}
        value={typeof block[field.key] === "string" ? (block[field.key] as string) : ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {block.kind === "text" ? (
        <small className="text-caption text-fg-dim">
          Fills in {"{task}"}, {"{model}"}, {"{version}"} and {"{slides}"} from the task.
        </small>
      ) : null}
    </div>
  );
}

function BlockPanel({
  block,
  count,
  index,
  onChange,
}: {
  block: EditorBlock | null;
  count: number;
  index: number;
  onChange: (field: string, value: unknown) => void;
}) {
  if (block === null) {
    return (
      <p className="m-0 text-body-sm text-fg-dim">
        Click a block on the page to set its title, width and fields.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-0.5 text-body-sm">
        <b>{blockCopy[block.kind].name}</b>
        <small className="text-caption text-fg-dim">
          Block {index + 1} of {count}. {blockCopy[block.kind].shows}.
        </small>
      </div>
      {blockFields[block.kind].map((field) => (
        <BlockFieldControl
          key={`${block.id}-${field.key}`}
          field={field}
          block={block}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
      <div className="grid gap-1.5">
        <label htmlFor={`${block.id}-title`} className="text-body-sm font-semibold">
          Title
        </label>
        <input
          id={`${block.id}-title`}
          className={inputClass}
          value={block.title}
          maxLength={120}
          onChange={(event) => onChange("title", event.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={`${block.id}-show-title`} className="font-semibold">
          Show the title
        </span>
        <Switch
          aria-labelledby={`${block.id}-show-title`}
          checked={block.show_title}
          onCheckedChange={(checked) => onChange("show_title", checked)}
        />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel id={`${block.id}-width`}>Width</FieldLabel>
        <SegmentedControl
          aria-labelledby={`${block.id}-width`}
          value={block.width}
          onValueChange={(value) => onChange("width", String(value))}
          options={[
            { value: "full", label: "Full width" },
            { value: "half", label: "Half" },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={`${block.id}-page-break`} className="font-semibold">
          Start on a new page
        </span>
        <Switch
          aria-labelledby={`${block.id}-page-break`}
          checked={block.page_break}
          onCheckedChange={(checked) => onChange("page_break", checked)}
        />
      </div>
    </div>
  );
}

function FormatPanel({
  format,
  onChange,
  head,
}: {
  format: FormatSettings;
  onChange: (format: FormatSettings) => void;
  head?: React.ReactNode;
}) {
  const set = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) =>
    onChange({ ...format, [key]: value });
  const segment = <K extends keyof FormatSettings>(
    key: K,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <div className="grid gap-1.5">
      <FieldLabel id={`format-${key}`}>{label}</FieldLabel>
      <SegmentedControl
        aria-labelledby={`format-${key}`}
        value={String(format[key])}
        onValueChange={(value) =>
          set(key, (key === "decimals" ? Number(value) : String(value)) as FormatSettings[K])
        }
        options={options}
      />
    </div>
  );
  const toggle = (
    key: "logo" | "running_header" | "draft_watermark" | "signature",
    label: string,
  ) => (
    <div className="flex items-center justify-between gap-3 text-body-sm">
      <span id={`format-${key}`} className="font-semibold">
        {label}
      </span>
      <Switch
        aria-labelledby={`format-${key}`}
        checked={format[key]}
        onCheckedChange={(checked) => set(key, checked)}
      />
    </div>
  );
  const text = (key: "title" | "subtitle", label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`format-${key}`} className="text-body-sm font-semibold">
        {label}
      </label>
      <input
        id={`format-${key}`}
        className={inputClass}
        value={format[key]}
        maxLength={key === "title" ? 120 : 200}
        onChange={(event) => set(key, event.target.value)}
      />
      {hint ? <small className="text-caption text-fg-dim">{hint}</small> : null}
    </div>
  );
  const checks = <K extends "appendices" | "downloads">(
    key: K,
    label: string,
    options: { value: FormatSettings[K][number]; label: string }[],
    keepOne: boolean,
  ) => (
    <div role="group" aria-labelledby={`format-${key}`} className="grid gap-1.5">
      <FieldLabel id={`format-${key}`}>{label}</FieldLabel>
      {options.map((option) => (
        <div key={option.value} className="flex items-center gap-2 text-body-sm">
          <Checkbox
            aria-label={option.label}
            checked={(format[key] as string[]).includes(option.value)}
            onCheckedChange={() =>
              set(
                key,
                toggleIn(
                  format[key] as string[],
                  option.value,
                  options.map((item) => item.value),
                  keepOne,
                ) as FormatSettings[K],
              )
            }
          />
          <span aria-hidden="true">{option.label}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid gap-4">
      {head}
      {segment("paper", "Paper", [
        { value: "a4", label: "A4" },
        { value: "letter", label: "US Letter" },
      ])}
      {segment("orientation", "Orientation", [
        { value: "portrait", label: "Portrait" },
        { value: "landscape", label: "Landscape" },
      ])}
      {segment("text_size", "Text size", [
        { value: "small", label: "Small" },
        { value: "normal", label: "Normal" },
        { value: "large", label: "Large" },
      ])}
      {toggle("logo", "Workspace logo")}
      {text("title", "Title")}
      {text("subtitle", "Subtitle", "Fills in {task}, {model}, {version} and {slides}.")}
      {toggle("running_header", "Running header from page 2")}
      <div className="grid gap-1.5">
        <FieldLabel id="format-page_numbers">Page numbers</FieldLabel>
        <Select
          value={format.page_numbers}
          onValueChange={(value) => set("page_numbers", value as FormatSettings["page_numbers"])}
        >
          <SelectTrigger aria-label="Page numbers" className="w-full">
            <SelectValue>
              {{ "page-of": "Page 1 of 3", page: "1", none: "None" }[format.page_numbers]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page-of">Page 1 of 3</SelectItem>
            <SelectItem value="page">1</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {toggle("draft_watermark", "DRAFT watermark until signed off")}
      {toggle("signature", "Signature block")}
      <div className="grid gap-1.5">
        <FieldLabel id="format-label_language">Language of labels</FieldLabel>
        <Select
          value={format.label_language}
          onValueChange={(value) =>
            set("label_language", value as FormatSettings["label_language"])
          }
        >
          <SelectTrigger aria-label="Language of labels" className="w-full">
            <SelectValue>
              {{ en: "English", cs: "Czech", de: "German" }[format.label_language]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="cs">Czech</SelectItem>
            <SelectItem value="de">German</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {segment("decimals", "Decimals", [
        { value: "1", label: "0.9" },
        { value: "2", label: "0.86" },
        { value: "3", label: "0.861" },
      ])}
      {checks("appendices", "Appendices after the report", appendixOptions, false)}
      {checks("downloads", "Downloads offered", downloadOptions, true)}
    </div>
  );
}

type ReportEditorProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  name: string;
  blocks: EditorBlock[];
  onBlocksChange: (blocks: EditorBlock[]) => void;
  format: FormatSettings;
  onFormatChange: (format: FormatSettings) => void;
  formatHead?: React.ReactNode;
  presets?: React.ReactNode;
  initialSelected?: string | null;
  initialTab?: "block" | "format" | "presets";
  footer?: React.ReactNode;
};

function ReportEditor({
  name,
  blocks,
  onBlocksChange,
  format,
  onFormatChange,
  formatHead,
  presets,
  initialSelected = null,
  initialTab = "block",
  footer,
  className,
  ...props
}: ReportEditorProps) {
  const [selected, setSelected] = React.useState<string | null>(initialSelected);
  const [tab, setTab] = React.useState<string>(initialTab);
  const current = blocks.find((block) => block.id === selected) ?? null;
  const select = (id: string | null) => {
    setSelected(id);
    if (id !== null) setTab("block");
  };
  const addAfterSelected = (kind: BlockKind) => {
    const result = addBlock(blocks, kind, insertionIndex(blocks, selected));
    onBlocksChange(result.blocks);
    select(result.added.id);
  };
  return (
    <div
      data-slot="report-editor"
      className={cn("grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]", className)}
      {...props}
    >
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside
          aria-label="Block catalogue"
          className="grid content-start gap-2 overflow-auto border-r border-line bg-chrome p-3.5"
        >
          <b className="text-body-sm">Blocks</b>
          <p className="m-0 text-caption text-fg-dim">
            Drag one onto the page, or click it to add it after the selected block.
          </p>
          <div className="grid gap-1.5">
            {blockKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(dragType, `new:${kind}`);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addAfterSelected(kind)}
                className="grid cursor-grab grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 rounded-ctl border border-line bg-surf-field px-3 py-2 text-left text-body-sm text-fg hover:border-line-strong"
              >
                <Icon name="list" className="mt-0.5 text-fg-dim" />
                <span className="min-w-0">
                  <b className="block font-semibold">{blockCopy[kind].name}</b>
                  <small className="block text-caption text-fg-dim">{blockCopy[kind].shows}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div
          role="region"
          aria-label="The report as pages"
          className="overflow-auto bg-canvas p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) select(null);
          }}
        >
          <ReportPages
            title={name}
            blocks={blocks}
            format={format}
            selected={selected}
            onSelect={select}
            onBlocksChange={onBlocksChange}
            onSelectedChange={select}
          />
        </div>
        <aside className="overflow-auto border-l border-line bg-chrome p-3.5">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList>
              <TabsTrigger value="block">Block</TabsTrigger>
              <TabsTrigger value="format">Page and format</TabsTrigger>
              {presets ? <TabsTrigger value="presets">Task presets</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="block" className="pt-3">
              <BlockPanel
                block={current}
                count={blocks.length}
                index={blocks.findIndex((block) => block.id === selected)}
                onChange={(field, value) =>
                  current && onBlocksChange(setBlockField(blocks, current.id, field, value))
                }
              />
            </TabsContent>
            <TabsContent value="format" className="pt-3">
              <FormatPanel format={format} onChange={onFormatChange} head={formatHead} />
            </TabsContent>
            {presets ? (
              <TabsContent value="presets" className="grid gap-3 pt-3">
                {presets}
              </TabsContent>
            ) : null}
          </Tabs>
        </aside>
      </div>
      {footer}
    </div>
  );
}

export { FormatPanel, ReportEditor, type ReportEditorProps };
