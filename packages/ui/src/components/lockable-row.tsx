import { Button } from "@parfocal/ui/components/button";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const reasonMax = 120;

type LockableRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
  lockable?: boolean;
  locked?: boolean;
  onLockedChange?: (locked: boolean) => void;
  reason?: string;
  onReasonChange?: (reason: string) => void;
  reasonError?: React.ReactNode;
  reasonId?: string;
  children: React.ReactNode;
};

function LockableRow({
  label,
  lockable = false,
  locked = false,
  onLockedChange,
  reason = "",
  onReasonChange,
  reasonError,
  reasonId,
  className,
  children,
  ...props
}: LockableRowProps) {
  const on = lockable && locked;
  return (
    <div
      data-slot="lockable-row"
      data-locked={on || undefined}
      className={cn("grid grid-cols-[170px_minmax(0,1fr)_28px] items-start gap-3", className)}
      {...props}
    >
      <span className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1.5 text-body-sm text-fg-dim">
        <span>{label}</span>
        {on ? <StatusTag tone="accent">Locked</StatusTag> : null}
      </span>
      <div className="grid min-w-0 justify-items-start gap-2.5">
        {children}
        {on ? (
          <FormField
            label="Why it is locked"
            help="Reviewers see this reason next to the setting."
            error={reasonError}
            count={`${reason.length} of ${reasonMax}`}
            className="w-full max-w-108"
          >
            <TextFieldInput
              id={reasonId}
              value={reason}
              maxLength={reasonMax}
              placeholder="For example, confidence hidden this round"
              onChange={(event) => onReasonChange?.(event.target.value)}
            />
          </FormField>
        ) : null}
      </div>
      {lockable ? (
        <Button
          variant={on ? "primary" : "ghost"}
          size="icon-sm"
          aria-pressed={on}
          aria-label={`${on ? "Unlock" : "Lock"} ${label.toLowerCase()}`}
          title={on ? "Unlock" : "Lock for every reviewer"}
          onClick={() => onLockedChange?.(!on)}
          className={on ? "" : "border-transparent bg-transparent text-fg-dim"}
        >
          <Icon name={on ? "lock" : "unlock"} />
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

export { LockableRow, type LockableRowProps };
