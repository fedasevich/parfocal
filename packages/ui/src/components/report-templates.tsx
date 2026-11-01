import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { cn } from "cn";
import type * as React from "react";

type ReportBlock = { id: string; name: string; shows: string; setting?: string };

type BlockCatalogueProps = React.ComponentProps<"div"> & { blocks: ReportBlock[] };

function BlockCatalogue({ blocks, className, ...props }: BlockCatalogueProps) {
  return (
    <div data-slot="block-catalogue" className={cn("grid gap-1.5", className)} {...props}>
      {blocks.map((block) => (
        <button
          key={block.id}
          type="button"
          draggable
          className="grid cursor-grab grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 rounded-ctl border border-line bg-surf-field px-3 py-2 text-left text-body-sm text-fg hover:border-line-strong"
        >
          <Icon name="list" className="mt-0.5 text-fg-dim" />
          <span className="min-w-0">
            <b className="block font-semibold">{block.name}</b>
            <small className="block text-caption text-fg-dim">{block.shows}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

type ReportPagePreviewProps = React.ComponentProps<"div"> & {
  title: string;
  blocks: ReportBlock[];
  selected?: string;
  page?: number;
  pages?: number;
};

function ReportPagePreview({
  title,
  blocks,
  selected,
  page = 1,
  pages = 1,
  className,
  ...props
}: ReportPagePreviewProps) {
  return (
    <div
      data-slot="report-page-preview"
      className={cn(
        "grid aspect-[210/297] w-full max-w-120 content-start gap-3 rounded-sm bg-white p-7 text-[11px] text-[#111] shadow-pop",
        className,
      )}
      {...props}
    >
      <div className="flex justify-between border-b-[1.5px] border-[#222] pb-2">
        <div className="grid">
          <b className="text-[13px]">Parfocal</b>
          <span className="text-[9px] text-[#555]">Evaluation report</span>
        </div>
        <div className="grid justify-items-end text-right">
          <b className="text-[13px]">{title}</b>
          <span className="text-[9px] text-[#555]">
            Page {page} of {pages}
          </span>
        </div>
      </div>
      {blocks.map((block) => (
        <div
          key={block.id}
          data-selected={selected === block.id || undefined}
          className={cn(
            "grid gap-1 rounded-[3px] border border-dashed border-transparent p-1.5",
            selected === block.id && "border-[#1d5fd1] bg-[#1d5fd1]/5",
          )}
        >
          <b className="text-[12px]">{block.name}</b>
          <span className="text-[#555]">{block.shows}</span>
          <span className="h-10 rounded-[2px] bg-[repeating-linear-gradient(#f6f4ef_0_6px,#e2ded4_6px_7px)]" />
        </div>
      ))}
    </div>
  );
}

type BlockSettingsProps = React.ComponentProps<"div"> & { block: ReportBlock };

function BlockSettings({ block, className, ...props }: BlockSettingsProps) {
  return (
    <div data-slot="block-settings" className={cn("grid gap-4 text-body-sm", className)} {...props}>
      <div className="grid gap-1.5">
        <label htmlFor={`block-title-${block.id}`} className="font-semibold">
          Title
        </label>
        <input
          id={`block-title-${block.id}`}
          defaultValue={block.name}
          className="min-h-8 rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      </div>
      <div className="grid gap-1.5">
        <span id={`block-width-${block.id}`} className="font-semibold">
          Width
        </span>
        <SegmentedControl
          aria-labelledby={`block-width-${block.id}`}
          defaultValue="full"
          options={[
            { value: "full", label: "Full width" },
            { value: "half", label: "Half" },
          ]}
        />
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="font-semibold">Start on a new page</span>
        <Switch />
      </label>
      {block.setting ? (
        <div className="grid gap-1.5">
          <span className="font-semibold">{block.setting}</span>
          <span className="text-fg-dim">Set for this block only.</span>
        </div>
      ) : null}
    </div>
  );
}

type PdfPreviewProps = React.ComponentProps<"div"> & {
  title: string;
  pages: number;
  current?: number;
  failed?: boolean;
};

function PdfPreview({
  title,
  pages,
  current = 1,
  failed = false,
  className,
  ...props
}: PdfPreviewProps) {
  return (
    <div
      data-slot="pdf-preview"
      className={cn(
        "grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-zone border border-line bg-canvas",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 border-b border-line bg-chrome px-3 py-2 text-body-sm">
        <Icon name="file" />
        <b className="min-w-0 flex-1 truncate font-medium">{title}.pdf</b>
        <span className="font-mono text-caption text-fg-dim">
          {current} / {pages}
        </span>
        <Button size="sm" variant="ghost" aria-label="Zoom out">
          <Icon name="minus" />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Zoom in">
          <Icon name="plus" />
        </Button>
        <Button size="sm">Print</Button>
        <Button size="sm" variant="primary" disabled={failed}>
          <Icon name="download" />
          Download
        </Button>
      </div>
      <div className="grid min-h-0 grid-cols-[96px_minmax(0,1fr)]">
        <div className="grid content-start gap-2 overflow-auto border-r border-line bg-chrome p-2">
          {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              aria-label={`Page ${page}`}
              aria-current={page === current ? "page" : undefined}
              className="grid aspect-[210/297] cursor-pointer place-items-end rounded-[2px] border-2 border-transparent bg-white p-1 text-[9px] text-[#555] aria-[current=page]:border-accent"
            >
              {page}
            </button>
          ))}
        </div>
        <div className="grid place-items-center overflow-auto p-6">
          {failed ? (
            <div className="grid max-w-80 justify-items-center gap-2 text-center text-body-sm">
              <Icon name="warn" size="xl" className="text-warn" />
              <b>The PDF could not be made</b>
              <span className="text-fg-dim">The CSV files still download.</span>
            </div>
          ) : (
            <div className="aspect-[210/297] w-full max-w-90 bg-white shadow-pop" />
          )}
        </div>
      </div>
    </div>
  );
}

export {
  BlockCatalogue,
  type BlockCatalogueProps,
  BlockSettings,
  PdfPreview,
  type PdfPreviewProps,
  type ReportBlock,
  ReportPagePreview,
  type ReportPagePreviewProps,
};
