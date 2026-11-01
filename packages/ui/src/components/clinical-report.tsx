import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { CategoryTag, StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type Deposit = {
  id: string;
  slide: string;
  node?: number | undefined;
  objectId?: string | undefined;
  hand?: boolean | undefined;
  sizeMm?: number | undefined;
  size?: string | undefined;
  note?: string | undefined;
  removed?: boolean | undefined;
  removedText?: string | undefined;
};

function stagingCategory(sizeMm: number) {
  if (sizeMm > 2) return "Macrometastasis";
  if (sizeMm > 0.2) return "Micrometastasis";
  return "Isolated tumour cells";
}

function largestDeposit(deposits: Deposit[]) {
  return deposits
    .filter((deposit) => !deposit.removed && deposit.sizeMm !== undefined)
    .reduce<Deposit | undefined>(
      (best, deposit) => ((deposit.sizeMm ?? 0) > (best?.sizeMm ?? -1) ? deposit : best),
      undefined,
    );
}

const formatMm = (value: number) => value.toFixed(value < 1 ? 2 : 1);

type DepositTableProps = React.ComponentProps<"div"> & {
  deposits: Deposit[];
  onUndo?: (id: string) => void;
  onRemove?: (id: string) => void;
  onSizeChange?: (id: string, value: string) => void;
  onNoteChange?: (id: string, value: string) => void;
  onSizeBlur?: (id: string) => void;
  errors?: Partial<Record<string, string>>;
  sizeHelp?: Partial<Record<string, React.ReactNode>>;
  inputId?: (id: string) => string;
  showSuggestion?: boolean;
};

const rowGrid = "grid grid-cols-[32px_minmax(0,1.2fr)_150px_minmax(0,1fr)_28px] items-start gap-3";

function DepositSource({ deposit, largest }: { deposit: Deposit; largest: boolean }) {
  return (
    <span className="grid min-w-0 gap-0.5 pt-1">
      <b className="font-semibold text-fg">{deposit.slide}</b>
      <small className="text-caption text-fg-dim">
        {deposit.node === undefined ? "" : `Node ${deposit.node} · `}
        {deposit.hand || !deposit.objectId ? (
          "measured by hand"
        ) : (
          <>
            object <span className="font-mono">{deposit.objectId}</span>
          </>
        )}
      </small>
      {largest ? (
        <span className="mt-1">
          <StatusTag tone="accent">Largest, sets the category</StatusTag>
        </span>
      ) : null}
    </span>
  );
}

function DepositTable({
  deposits,
  onUndo,
  onRemove,
  onSizeChange,
  onNoteChange,
  onSizeBlur,
  errors = {},
  sizeHelp = {},
  inputId = (id) => `deposit-${id}-size`,
  showSuggestion = !onSizeChange,
  className,
  ...props
}: DepositTableProps) {
  const largest = largestDeposit(deposits);
  return (
    <div data-slot="deposit-table" className={cn("grid gap-2", className)} {...props}>
      {deposits.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          No deposit yet. Add one from an object on a slide, or measure one by hand.
        </p>
      ) : (
        <div className="grid text-body-sm leading-[1.45]">
          <div className={cn(rowGrid, "pb-1.5 text-caption text-fg-dim")}>
            <span />
            <span>Slide and source</span>
            <span>Size</span>
            <span>Note</span>
            <span />
          </div>
          {deposits.map((deposit) =>
            deposit.removed ? (
              <div
                key={deposit.id}
                role="status"
                data-removed="true"
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line py-2.5 text-fg-dim"
              >
                <span className="pt-1.5 font-mono font-semibold">{deposit.id}</span>
                <span className="grid min-w-0 gap-0.5 pt-1">
                  <b className="font-semibold">{deposit.id} removed</b>
                  <small className="text-caption">
                    {deposit.removedText ??
                      `${deposit.sizeMm === undefined ? "no size" : `${formatMm(deposit.sizeMm)} mm`}, ${deposit.objectId ? `${deposit.objectId} on` : "by hand on"} ${deposit.slide}`}
                  </small>
                </span>
                <Button size="sm" onClick={() => onUndo?.(deposit.id)}>
                  <Icon name="undo" />
                  Undo
                </Button>
              </div>
            ) : (
              <div
                key={deposit.id}
                data-deposit={deposit.id}
                data-largest={deposit.id === largest?.id || undefined}
                className={cn(rowGrid, "border-t border-line py-2.5")}
              >
                <span className="pt-1.5 font-mono font-semibold text-fg">{deposit.id}</span>
                <DepositSource deposit={deposit} largest={deposit.id === largest?.id} />
                <div className="grid gap-1">
                  {onSizeChange ? (
                    <span className="flex items-center gap-1.5">
                      <Input
                        id={inputId(deposit.id)}
                        inputMode="decimal"
                        aria-label={`Size of ${deposit.id} in mm`}
                        aria-invalid={errors[deposit.id] ? true : undefined}
                        value={
                          deposit.size ??
                          (deposit.sizeMm === undefined ? "" : String(deposit.sizeMm))
                        }
                        onChange={(event) => onSizeChange(deposit.id, event.target.value)}
                        onBlur={() => onSizeBlur?.(deposit.id)}
                        className="w-22 text-center font-mono tabular-nums"
                      />
                      <span className="text-body-sm text-fg-dim">mm</span>
                    </span>
                  ) : (
                    <span className="pt-1 font-mono tabular-nums">
                      {deposit.sizeMm === undefined ? (
                        <span className="text-warn">No size yet</span>
                      ) : (
                        `${formatMm(deposit.sizeMm)} mm`
                      )}
                    </span>
                  )}
                  {errors[deposit.id] ? (
                    <span role="alert" className="flex items-start gap-1 text-caption text-bad">
                      <Icon name="warn" size="xs" className="mt-0.5" />
                      {errors[deposit.id]}
                    </span>
                  ) : sizeHelp[deposit.id] ? (
                    <span className="text-caption">{sizeHelp[deposit.id]}</span>
                  ) : null}
                </div>
                {onNoteChange ? (
                  <Input
                    aria-label={`Note on ${deposit.id}`}
                    placeholder="Note, optional"
                    maxLength={120}
                    value={deposit.note ?? ""}
                    onChange={(event) => onNoteChange(deposit.id, event.target.value)}
                  />
                ) : (
                  <span className="truncate pt-1 text-fg-dim">{deposit.note ?? ""}</span>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="mt-1"
                  title={`Remove ${deposit.id}`}
                  aria-label={`Remove ${deposit.id}`}
                  onClick={() => onRemove?.(deposit.id)}
                >
                  <Icon name="close" />
                </Button>
              </div>
            ),
          )}
        </div>
      )}
      {showSuggestion && largest?.sizeMm !== undefined ? (
        <p className="m-0 inline-flex items-center gap-2 text-body-sm text-fg-dim">
          The largest deposit, {formatMm(largest.sizeMm)} mm on {largest.slide}, suggests
          <CategoryTag>{stagingCategory(largest.sizeMm)}</CategoryTag>
        </p>
      ) : null}
    </div>
  );
}

type CoSignRow = {
  label: string;
  author: string;
  coSigner: React.ReactNode;
  ai?: string | undefined;
  changed?: boolean | undefined;
  icon?: React.ComponentProps<typeof Icon>["name"] | undefined;
};

type CoSignColumnsProps = React.ComponentProps<"div"> & {
  authorName: React.ReactNode;
  coSignerName: React.ReactNode;
  rows: CoSignRow[];
};

function CoSignColumns({
  authorName,
  coSignerName,
  rows,
  className,
  ...props
}: CoSignColumnsProps) {
  return (
    <div
      data-slot="co-sign-columns"
      className={cn("grid text-body-sm leading-[1.45]", className)}
      {...props}
    >
      <div className="grid grid-cols-[170px_minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-4 px-2 pb-2.5">
        <span />
        <span>{authorName}</span>
        <span>{coSignerName}</span>
      </div>
      {rows.map((row) => {
        const changed =
          row.changed ?? (typeof row.coSigner === "string" && row.author !== row.coSigner);
        return (
          <div
            key={row.label}
            data-changed={changed || undefined}
            className={cn(
              "grid grid-cols-[170px_minmax(0,1fr)_minmax(0,1.35fr)] items-start gap-4 rounded-md border-t border-line px-2 py-2.5",
              changed && "border-t-transparent bg-accent-soft",
            )}
          >
            <span className="flex flex-wrap items-center gap-1.5 pt-1 text-fg-dim">
              {row.icon ? <Icon name={row.icon} /> : null}
              <span>{row.label}</span>
              {changed ? <b className="text-caption font-semibold text-accent">changed</b> : null}
            </span>
            <span className="grid pt-1 text-fg">
              {row.author || <span className="text-fg-faint">None</span>}
              {row.ai ? <small className="text-caption text-fg-faint">AI {row.ai}</small> : null}
            </span>
            <div className="min-w-0">
              {typeof row.coSigner === "string" ? (
                <span className="block pt-1">
                  {row.coSigner || <span className="text-fg-faint">None</span>}
                </span>
              ) : (
                row.coSigner
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ReportDocumentModel = {
  status: "draft" | "final" | "amended";
  lab: { name: string; department: string; address: string; footer: string };
  head: [string, string][];
  amendment?:
    | {
        title: string;
        reason: string;
        changes: [string, string | null, string | null][];
        note: string;
      }
    | undefined;
  sections: { title: string; body?: string | undefined; diagnosis?: boolean | undefined }[];
  synopticTitle: string;
  standards: [string, string][];
  rows: [string, string][];
  after: { title: string; body: string }[];
  sign: { by: string; at: string } | null;
};

type ReportDocumentProps = React.ComponentProps<"article"> & { model: ReportDocumentModel };

function ReportDocument({ model, className, ...props }: ReportDocumentProps) {
  const heading = (title: string) => (
    <h4 className="m-0 mt-3 border-b border-[#bbb] pb-0.5 text-[10px] font-bold tracking-[0.06em] text-[#333] uppercase">
      {title}
    </h4>
  );
  return (
    <article
      data-slot="report-document"
      data-status={model.status}
      aria-label="Report"
      className={cn(
        "relative grid w-full max-w-[595px] content-start gap-1.5 overflow-hidden rounded-sm bg-white px-10 py-9 text-[11px] leading-[1.5] text-[#111] shadow-pop",
        className,
      )}
      {...props}
    >
      {model.status === "draft" ? (
        <i
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center text-[88px] font-bold text-[#000]/5 not-italic -rotate-30"
        >
          DRAFT
        </i>
      ) : null}
      <div className="flex justify-between gap-4 border-b-[1.5px] border-[#222] pb-2">
        <div className="grid">
          <b className="text-[13px]">{model.lab.name}</b>
          <span className="text-[9px] text-[#555]">{model.lab.department}</span>
          <span className="text-[9px] text-[#555]">{model.lab.address}</span>
        </div>
        <div className="grid justify-items-end text-right">
          <b className="text-[12px]">
            {model.status === "amended" ? "AMENDED REPORT" : "SURGICAL PATHOLOGY REPORT"}
          </b>
          <span className="text-[9px] text-[#555]">
            {model.status === "draft"
              ? "Draft, not signed"
              : model.status === "amended"
                ? "Version 2, replaces version 1"
                : "Final report, version 1"}
          </span>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-0.5 py-1.5">
        {model.head.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-[#555]">{label}</dt>
            <dd className="m-0 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {model.amendment ? (
        <div className="grid gap-0.5 rounded-[3px] border border-[#c9a227] bg-[#fdf6dc] px-2.5 py-2">
          <b>{model.amendment.title}</b>
          <p className="m-0">Reason: {model.amendment.reason}</p>
          {model.amendment.changes.map(([label, before, after]) => (
            <p key={label} className="m-0">
              <span className="text-[#555]">{label}:</span>{" "}
              {before === null ? (
                "rewritten"
              ) : (
                <>
                  <s>{before}</s> → <b>{after}</b>
                </>
              )}
            </p>
          ))}
          <p className="m-0 text-[9px] text-[#555]">{model.amendment.note}</p>
        </div>
      ) : null}
      {model.sections.map((section) => (
        <div key={section.title} className="grid gap-0.5">
          {heading(section.title)}
          <p className={cn("m-0", section.diagnosis && "font-semibold")}>{section.body}</p>
        </div>
      ))}
      {heading(model.synopticTitle)}
      {model.standards.length ? (
        <p className="m-0 grid gap-0.5 text-[9px] text-[#555]">
          {model.standards.map(([name, text]) => (
            <span key={name}>
              <b>{name}</b> {text}
            </span>
          ))}
        </p>
      ) : null}
      <dl className="m-0 grid gap-0.5">
        {model.rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <dt className="text-[#555]">{label}:</dt>
            <dd className="m-0 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {model.after.map((section) => (
        <div key={section.title} className="grid gap-0.5">
          {heading(section.title)}
          <p className="m-0">{section.body}</p>
        </div>
      ))}
      <div className="mt-4 grid gap-0.5 border-t border-[#bbb] pt-2">
        {model.sign ? (
          <>
            <b>{model.sign.by}</b>
            <span>on {model.sign.at}</span>
            <span className="text-[9px] text-[#555]">
              I have reviewed the whole-slide images and rendered this diagnosis.
            </span>
          </>
        ) : (
          <>
            <b>Not signed</b>
            <span className="text-[9px] text-[#555]">
              Draft. Not for clinical use until it is signed.
            </span>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-between text-[8px] text-[#777]">
        <span>{model.lab.footer}</span>
        <span>Page 1 of 1</span>
      </div>
    </article>
  );
}

export {
  CoSignColumns,
  type CoSignColumnsProps,
  type CoSignRow,
  type Deposit,
  DepositTable,
  type DepositTableProps,
  formatMm,
  largestDeposit,
  ReportDocument,
  type ReportDocumentModel,
  type ReportDocumentProps,
  stagingCategory,
};
