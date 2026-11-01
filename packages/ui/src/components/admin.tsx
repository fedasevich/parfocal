import { Switch } from "@parfocal/ui/components/switch";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type Stat = { value: React.ReactNode; label: string; detail: React.ReactNode };

function StatStrip({
  stats,
  className,
  ...props
}: React.ComponentProps<"div"> & { stats: Stat[] }) {
  return (
    <div
      data-slot="stat-strip"
      className={cn(
        "grid grid-cols-4 rounded-zone border border-surf-edge bg-surf-section px-(--pad-zone) py-5",
        className,
      )}
      {...props}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="grid min-w-0 gap-0.75 border-l border-line px-4.5 first:border-l-0 first:pl-0"
        >
          <b className="font-mono text-[24px] leading-[1.1] font-semibold text-fg">{stat.value}</b>
          <span className="text-body-sm text-fg-dim">{stat.label}</span>
          <small className="text-caption text-fg-faint">{stat.detail}</small>
        </div>
      ))}
    </div>
  );
}

type StoragePart = { label: string; tb: number; colour: string };

const tb = (value: number) => `${+value.toFixed(1)} TB`;

type StorageBarProps = React.ComponentProps<"div"> & {
  parts: StoragePart[];
  totalTb: number;
  size?: "md" | "sm";
  foot?: React.ReactNode;
};

function StorageBar({ parts, totalTb, size = "md", foot, className, ...props }: StorageBarProps) {
  const used = parts.reduce((sum, part) => sum + part.tb, 0);
  const free = Math.max(0, totalTb - used);
  const label = `${tb(used)} of ${tb(totalTb)} used. ${parts
    .map((part) => `${part.label} ${tb(part.tb)}`)
    .join(", ")}, free ${tb(free)}`;
  return (
    <div data-slot="storage-bar" className={cn("grid min-w-0 gap-2.5", className)} {...props}>
      <div
        className={cn(
          "flex items-baseline gap-1.5 text-fg-dim",
          size === "sm" ? "text-body-sm" : "text-body",
        )}
      >
        <b
          className={cn(
            "font-semibold tracking-[-0.01em] text-fg",
            size === "sm" ? "text-[18px]" : "text-[24px]",
          )}
        >
          {tb(used)}
        </b>
        <span>of {tb(totalTb)} used</span>
      </div>
      <div
        role="img"
        aria-label={label}
        className={cn(
          "flex gap-0.5 overflow-hidden",
          size === "sm" ? "h-2.5 rounded-sm" : "h-3.5 rounded-[5px]",
        )}
      >
        {parts.map((part) => (
          <i
            key={part.label}
            className="block min-w-0.75"
            style={{ flex: `${part.tb} 0 0`, background: part.colour }}
          />
        ))}
        {free > 0 ? <i className="block bg-track" style={{ flex: `${free} 0 0` }} /> : null}
      </div>
      <div
        className={cn(
          "flex flex-wrap text-fg-dim",
          size === "sm" ? "gap-x-3.5 gap-y-1 text-caption" : "gap-x-4.5 gap-y-1.5 text-body-sm",
        )}
      >
        {[...parts, { label: "Free", tb: free, colour: "" }].map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1.75">
            <i
              className={cn(
                "size-2.5 flex-none rounded-full",
                part.colour ? "" : "bg-track shadow-[inset_0_0_0_1px_var(--line-strong)]",
              )}
              style={part.colour ? { background: part.colour } : undefined}
            />
            {part.label}
            <b className="font-mono font-medium text-fg">{tb(part.tb)}</b>
          </span>
        ))}
      </div>
      {foot ? <div className="text-body-sm leading-[1.45] text-fg-dim">{foot}</div> : null}
    </div>
  );
}

type SettingRowProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  label: string;
  detail?: React.ReactNode;
  on: boolean;
  locked?: boolean;
  onChange?: (on: boolean) => void;
};

function SettingRow({ label, detail, on, locked, onChange, className, ...props }: SettingRowProps) {
  return (
    <div
      data-slot="setting-row"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-body-sm first:pt-0.5 [&+&]:border-t [&+&]:border-line",
        className,
      )}
      {...props}
    >
      <span>
        <b className="block font-semibold text-fg">{label}</b>
        {detail ? (
          <small className="mt-0.5 block text-body-sm leading-[1.45] text-fg-dim">{detail}</small>
        ) : null}
      </span>
      <Switch
        aria-label={label}
        checked={on}
        disabled={locked ?? false}
        onCheckedChange={(next) => onChange?.(next)}
      />
    </div>
  );
}

type NameCellProps = Omit<React.ComponentProps<"span">, "title"> & {
  lead: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  version?: string;
};

function NameCell({ lead, title, sub, version, className, ...props }: NameCellProps) {
  return (
    <span
      data-slot="name-cell"
      className={cn("inline-flex min-w-0 items-center gap-2.5", className)}
      {...props}
    >
      <span className="flex-none text-fg-dim">{lead}</span>
      <span className="min-w-0">
        <b className="block truncate font-semibold text-fg">
          {title}
          {version ? (
            <span className="ml-1 font-mono text-caption font-normal text-fg-faint">{version}</span>
          ) : null}
        </b>
        {sub ? <small className="block truncate text-caption text-fg-dim">{sub}</small> : null}
      </span>
    </span>
  );
}

function SummaryRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="summary-row"
      className={cn(
        "grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-1.75 text-body-sm text-fg-dim first:border-t-0",
        className,
      )}
      {...props}
    />
  );
}

export { NameCell, SettingRow, type Stat, StatStrip, StorageBar, type StoragePart, SummaryRow };
