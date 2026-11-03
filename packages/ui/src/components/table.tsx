import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import type { PickState, SortDirection } from "@parfocal/ui/lib/table-state";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-body-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-line-strong", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({
  className,
  selected,
  ...props
}: React.ComponentProps<"tr"> & { selected?: boolean | undefined }) {
  return (
    <tr
      data-slot="table-row"
      {...(selected ? { "data-state": "selected" } : {})}
      className={cn(
        "border-b border-line transition-colors hover:bg-[color-mix(in_srgb,var(--fg)_4%,transparent)] has-aria-expanded:bg-muted/50 data-[state=selected]:bg-accent-soft aria-selected:bg-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-(--density-head-h) px-2 py-(--density-head-y) text-left align-middle text-caption font-semibold whitespace-nowrap text-fg-dim [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

const cellKinds = {
  text: "",
  number: "text-right tabular-nums",
  id: "font-mono",
} as const;

type CellKind = keyof typeof cellKinds;

function TableCell({
  className,
  kind = "text",
  ...props
}: React.ComponentProps<"td"> & { kind?: CellKind }) {
  return (
    <td
      data-slot="table-cell"
      data-kind={kind}
      className={cn(
        "px-2 py-(--density-cell-y) align-middle whitespace-nowrap text-fg-dim [&:has([role=checkbox])]:pr-0 [&_b]:font-medium [&_b]:text-fg",
        cellKinds[kind],
        className,
      )}
      {...props}
    />
  );
}

const sortWords = { ascending: "sorted low to high", descending: "sorted high to low" } as const;

function TableSortHead({
  className,
  children,
  direction,
  onSort,
  numeric,
  ...props
}: Omit<React.ComponentProps<"th">, "onClick"> & {
  direction?: SortDirection | undefined;
  onSort: () => void;
  numeric?: boolean;
}) {
  return (
    <TableHead
      aria-sort={direction ?? "none"}
      className={cn(numeric && "text-right", className)}
      {...props}
    >
      <button
        type="button"
        data-slot="table-sort"
        data-direction={direction ?? "none"}
        onClick={onSort}
        className={cn(
          "group/sort inline-flex items-center gap-1 rounded-sm font-semibold hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid",
          direction && "text-fg",
          numeric && "flex-row-reverse",
        )}
      >
        {children}
        <Icon
          name="down"
          size="xs"
          aria-hidden
          className={cn(
            "transition-transform",
            direction === "ascending" && "rotate-180",
            !direction &&
              "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
          )}
        />
        {direction ? <span className="sr-only"> ({sortWords[direction]})</span> : null}
      </button>
    </TableHead>
  );
}

function TablePickHead({
  className,
  state,
  onToggle,
  label = "Pick every row",
  disabled,
  ...props
}: React.ComponentProps<"th"> & {
  state: PickState;
  onToggle: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <TableHead data-slot="table-pick-head" className={cn("w-8", className)} {...props}>
      <Checkbox
        aria-label={label}
        checked={state === "all"}
        indeterminate={state === "some"}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </TableHead>
  );
}

function TablePickCell({
  className,
  picked,
  onToggle,
  label,
  ...props
}: React.ComponentProps<"td"> & { picked: boolean; onToggle: () => void; label: string }) {
  return (
    <TableCell data-slot="table-pick-cell" className={cn("w-8", className)} {...props}>
      <Checkbox aria-label={label} checked={picked} onCheckedChange={onToggle} />
    </TableCell>
  );
}

function TableEmpty({
  className,
  colSpan,
  title,
  children,
  ...props
}: React.ComponentProps<"tr"> & { colSpan: number; title: React.ReactNode }) {
  return (
    <tr data-slot="table-empty" className={className} {...props}>
      <td colSpan={colSpan} className="px-2 py-8 text-center whitespace-normal">
        <b className="block text-body-sm font-medium text-fg">{title}</b>
        {children ? <span className="mt-1 block text-body-sm text-fg-dim">{children}</span> : null}
      </td>
    </tr>
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export type { CellKind };
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableEmpty,
  TableFooter,
  TableHead,
  TableHeader,
  TablePickCell,
  TablePickHead,
  TableRow,
  TableSortHead,
};
