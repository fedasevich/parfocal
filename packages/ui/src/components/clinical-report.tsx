import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { CategoryTag, ObjectIdTag } from "@parfocal/ui/components/tag";
import { cn } from "cn";
import type * as React from "react";

type Deposit = {
  id: string;
  slide: string;
  objectId?: string;
  hand?: boolean;
  sizeMm?: number;
  note?: string;
  removed?: boolean;
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

type DepositTableProps = React.ComponentProps<"div"> & {
  deposits: Deposit[];
  onUndo?: (id: string) => void;
  onRemove?: (id: string) => void;
};

function DepositTable({ deposits, onUndo, onRemove, className, ...props }: DepositTableProps) {
  const largest = largestDeposit(deposits);
  return (
    <div data-slot="deposit-table" className={cn("grid gap-2", className)} {...props}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slide</TableHead>
            <TableHead>From</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deposits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center">
                No deposits yet. Add one from an object or a hand measurement.
              </TableCell>
            </TableRow>
          ) : null}
          {deposits.map((deposit) =>
            deposit.removed ? (
              <TableRow key={deposit.id}>
                <TableCell colSpan={4} className="text-fg-faint italic">
                  {deposit.objectId ?? "Hand measurement"} on {deposit.slide} removed
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onUndo?.(deposit.id)}>
                    <Icon name="undo" />
                    Undo
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow
                key={deposit.id}
                data-state={deposit.id === largest?.id ? "selected" : undefined}
              >
                <TableCell>
                  <b>{deposit.slide}</b>
                </TableCell>
                <TableCell>
                  {deposit.hand ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="ruler" />
                      Hand measurement
                    </span>
                  ) : (
                    <ObjectIdTag>{deposit.objectId}</ObjectIdTag>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {deposit.sizeMm === undefined ? (
                    <span className="text-warn">No size yet</span>
                  ) : (
                    `${deposit.sizeMm.toFixed(1)} mm`
                  )}
                </TableCell>
                <TableCell className="max-w-56 truncate">{deposit.note ?? ""}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove the deposit on ${deposit.slide}`}
                    onClick={() => onRemove?.(deposit.id)}
                  >
                    <Icon name="close" />
                  </Button>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      {largest?.sizeMm !== undefined ? (
        <p className="m-0 inline-flex items-center gap-2 text-body-sm text-fg-dim">
          The largest deposit, {largest.sizeMm.toFixed(1)} mm on {largest.slide}, suggests
          <CategoryTag>{stagingCategory(largest.sizeMm)}</CategoryTag>
        </p>
      ) : null}
    </div>
  );
}

type CoSignRow = {
  label: string;
  author: string;
  coSigner: string;
  ai?: string;
};

type CoSignColumnsProps = React.ComponentProps<"div"> & {
  authorName: string;
  coSignerName: string;
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
    <div data-slot="co-sign-columns" className={cn("grid", className)} {...props}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Value</TableHead>
            <TableHead>{authorName}</TableHead>
            <TableHead>{coSignerName}</TableHead>
            <TableHead>AI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const changed = row.author !== row.coSigner;
            return (
              <TableRow
                key={row.label}
                data-changed={changed || undefined}
                className={changed ? "bg-warn-soft" : ""}
              >
                <TableCell>
                  <b>{row.label}</b>
                </TableCell>
                <TableCell>{row.author}</TableCell>
                <TableCell className={changed ? "font-semibold text-fg" : ""}>
                  {row.coSigner}
                  {changed ? <span className="sr-only"> (changed)</span> : null}
                </TableCell>
                <TableCell className="text-fg-faint">{row.ai ?? ""}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export {
  CoSignColumns,
  type CoSignColumnsProps,
  type CoSignRow,
  type Deposit,
  DepositTable,
  type DepositTableProps,
  largestDeposit,
  stagingCategory,
};
