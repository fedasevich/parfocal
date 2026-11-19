import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { ScrollArea } from "@parfocal/ui/components/scroll-area";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type ReportBlock = { id: string; name: string; shows: string; setting?: string };

type BlockCatalogueProps = React.ComponentProps<"div"> & {
  blocks: ReportBlock[];
  onAdd?: (id: string) => void;
};

function BlockCatalogue({ blocks, onAdd, className, ...props }: BlockCatalogueProps) {
  return (
    <div data-slot="block-catalogue" className={cn("grid gap-1.5", className)} {...props}>
      {blocks.map((block) => (
        <button
          key={block.id}
          type="button"
          draggable
          onClick={() => onAdd?.(block.id)}
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
  onBlockSelect?: (id: string) => void;
};

function ReportPagePreview({
  title,
  blocks,
  selected,
  page = 1,
  pages = 1,
  onBlockSelect,
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
          <b className="text-[13px]">
            <Trans>Parfocal</Trans>
          </b>
          <span className="text-[9px] text-[#555]">
            <Trans>Evaluation report</Trans>
          </span>
        </div>
        <div className="grid justify-items-end text-right">
          <b className="text-[13px]">{title}</b>
          <span className="text-[9px] text-[#555]">
            <Trans>
              Page {page} of {pages}
            </Trans>
          </span>
        </div>
      </div>
      {blocks.map((block) => (
        <button
          type="button"
          key={block.id}
          data-selected={selected === block.id || undefined}
          aria-pressed={selected === block.id}
          onClick={() => onBlockSelect?.(block.id)}
          className={cn(
            "grid cursor-pointer gap-1 rounded-[3px] border border-dashed border-transparent bg-transparent p-1.5 text-left text-[#111]",
            selected === block.id && "border-[#1d5fd1] bg-[#1d5fd1]/5",
          )}
        >
          <b className="text-[12px]">{block.name}</b>
          <span className="text-[#555]">{block.shows}</span>
          <span className="h-10 rounded-[2px] bg-[repeating-linear-gradient(#f6f4ef_0_6px,#e2ded4_6px_7px)]" />
        </button>
      ))}
    </div>
  );
}

type BlockSettingsProps = React.ComponentProps<"div"> & { block: ReportBlock };

function BlockSettings({ block, className, ...props }: BlockSettingsProps) {
  const { t } = useLingui();

  return (
    <div data-slot="block-settings" className={cn("grid gap-4 text-body-sm", className)} {...props}>
      <div className="grid gap-1.5">
        <label htmlFor={`block-title-${block.id}`} className="font-semibold">
          <Trans>Title</Trans>
        </label>
        <input
          id={`block-title-${block.id}`}
          defaultValue={block.name}
          className="min-h-8 rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      </div>
      <div className="grid gap-1.5">
        <span id={`block-width-${block.id}`} className="font-semibold">
          <Trans>Width</Trans>
        </span>
        <SegmentedControl
          aria-labelledby={`block-width-${block.id}`}
          defaultValue="full"
          options={[
            { value: "full", label: t`Full width` },
            { value: "half", label: t`Half` },
          ]}
        />
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="font-semibold">
          <Trans>Start on a new page</Trans>
        </span>
        <Switch />
      </label>
      {block.setting ? (
        <div className="grid gap-1.5">
          <span className="font-semibold">{block.setting}</span>
          <span className="text-fg-dim">
            <Trans>Set for this block only.</Trans>
          </span>
        </div>
      ) : null}
    </div>
  );
}

type PdfPreviewProps = React.ComponentProps<"div"> & {
  title: string;
  pages: number;
  pageWidth?: number;
  current?: number;
  failed?: boolean;
  loading?: boolean;
  meta?: React.ReactNode;
  renderPage?: (page: number) => React.ReactNode;
  renderThumbnail?: (page: number) => React.ReactNode;
  onCurrentChange?: (page: number) => void;
  onPrint?: () => void;
  onDownload?: () => void;
  onClose?: () => void;
};

const READING_LINE = 120;
const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;
const PAGE_GAP = 48;

const zoomIn = (value: number) =>
  Math.min(ZOOM_MAX, Math.floor(value / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP);
const zoomOut = (value: number) =>
  Math.max(ZOOM_MIN, Math.ceil(value / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP);

function useFitZoom(holder: React.RefObject<HTMLDivElement | null>, pageWidth: number) {
  const [fit, setFit] = React.useState(100);
  React.useLayoutEffect(() => {
    const node = holder.current;
    if (!node) return;
    const measure = () => {
      const room = node.clientWidth - PAGE_GAP;
      if (room <= 0) return;
      const wanted = Math.floor((room / pageWidth) * 100);
      setFit(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, wanted)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [holder, pageWidth]);
  return fit;
}

function PdfPreview({
  title,
  pages,
  pageWidth = 794,
  current = 1,
  failed = false,
  loading = false,
  meta,
  renderPage,
  renderThumbnail,
  onCurrentChange,
  onPrint,
  onDownload,
  onClose,
  className,
  ...props
}: PdfPreviewProps) {
  const { t } = useLingui();

  const [chosen, setChosen] = React.useState<number | null>(null);
  const [inner, setInner] = React.useState(current);
  const holder = React.useRef<HTMLDivElement>(null);
  const fit = useFitZoom(holder, pageWidth);
  const zoom = chosen ?? fit;
  const scroller = () =>
    holder.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;
  const numbers = Array.from({ length: pages }, (_, index) => index + 1);
  const shown = onCurrentChange ? current : inner;
  const pageNodes = () =>
    Array.from(scroller()?.querySelectorAll<HTMLElement>("[data-pdf-page]") ?? []);
  const follow = () => {
    const box = scroller();
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    let reading = 1;
    pageNodes().forEach((node, index) => {
      if (node.getBoundingClientRect().top - top < READING_LINE) reading = index + 1;
    });
    if (reading === shown) return;
    setInner(reading);
    onCurrentChange?.(reading);
  };
  const jumpTo = (page: number) => {
    const box = scroller();
    const node = pageNodes()[page - 1];
    if (box && node) {
      box.scrollTop += node.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
    }
    setInner(page);
    onCurrentChange?.(page);
  };
  const thumbnail = renderThumbnail ?? renderPage;
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
        <b className="min-w-0 truncate font-medium">
          <Trans>{title}.pdf</Trans>
        </b>
        {meta ? <span className="min-w-0 flex-1 truncate text-fg-dim">{meta}</span> : null}
        <output
          aria-label={t`Current page`}
          className={cn("font-mono text-caption text-fg-dim", meta ? "" : "ml-auto")}
        >
          {shown} / {pages}
        </output>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t`Zoom out`}
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setChosen(zoomOut(zoom))}
        >
          <Icon name="minus" />
        </Button>
        <output aria-label={t`Zoom`} className="w-10 text-center font-mono text-caption">
          {zoom}%
        </output>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t`Zoom in`}
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setChosen(zoomIn(zoom))}
        >
          <Icon name="plus" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t`Fit the page to the width`}
          aria-pressed={chosen === null}
          onClick={() => setChosen(null)}
        >
          <Icon name="frame" />
        </Button>
        <Button size="sm" disabled={failed || loading} onClick={onPrint}>
          <Trans>Print</Trans>
        </Button>
        <Button size="sm" variant="primary" disabled={failed || loading} onClick={onDownload}>
          <Icon name="download" />
          <Trans>Download</Trans>
        </Button>
        {onClose ? (
          <Button size="sm" variant="ghost" aria-label={t`Close the preview`} onClick={onClose}>
            <Icon name="close" />
          </Button>
        ) : null}
      </div>
      <div className="grid min-h-0 grid-cols-[124px_minmax(0,1fr)]">
        <div
          role="group"
          aria-label={t`Pages`}
          className="grid content-start gap-3 overflow-auto border-r border-line bg-chrome p-3"
        >
          {numbers.map((page) => (
            <button
              key={page}
              type="button"
              aria-current={page === shown ? "page" : undefined}
              onClick={() => jumpTo(page)}
              className="group grid cursor-pointer justify-items-center gap-1 border-0 bg-transparent p-0 text-caption text-fg-dim"
            >
              <span
                className={cn(
                  "relative block w-full overflow-hidden border-2 border-transparent bg-white group-aria-[current=page]:border-accent",
                  pageWidth > 1000 ? "aspect-[297/210]" : "aspect-[210/297]",
                )}
              >
                {thumbnail ? (
                  <span
                    aria-hidden="true"
                    inert
                    className={cn(
                      "pointer-events-none block",
                      renderThumbnail
                        ? "h-full w-full"
                        : `absolute top-0 left-0 origin-top-left scale-[0.15]`,
                    )}
                  >
                    {thumbnail(page)}
                  </span>
                ) : null}
              </span>
              <span>
                <span className="sr-only">
                  <Trans>Page</Trans>{" "}
                </span>
                {page}
              </span>
            </button>
          ))}
        </div>
        <div ref={holder} onScrollCapture={follow} className="min-h-0">
          <ScrollArea
            className="h-full"
            viewportProps={{ tabIndex: 0, role: "region", "aria-label": t`Pages of the report` }}
          >
            <div className="grid w-max min-w-full justify-items-center gap-6 p-6">
              {failed ? (
                <div className="grid max-w-80 justify-items-center gap-2 self-center text-center text-body-sm">
                  <Icon name="warn" size="xl" className="text-warn" />
                  <b>
                    <Trans>The PDF could not be made</Trans>
                  </b>
                  <span className="text-fg-dim">
                    <Trans>The CSV files still download.</Trans>
                  </span>
                </div>
              ) : loading ? (
                <span role="status" className="self-center text-body-sm text-fg-dim">
                  <Trans>Making the preview</Trans>
                </span>
              ) : renderPage ? (
                numbers.map((page) => (
                  <div
                    key={page}
                    data-pdf-page={page}
                    className="max-w-none"
                    style={{ width: Math.round((pageWidth * zoom) / 100) }}
                  >
                    {renderPage(page)}
                  </div>
                ))
              ) : (
                <div className="aspect-[210/297] w-full max-w-90 bg-white shadow-pop" />
              )}
            </div>
          </ScrollArea>
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
