import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "cn";
import type * as React from "react";
import { useId } from "react";

type ControlRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  locked?: { value: React.ReactNode; reason: React.ReactNode } | undefined;
  children?: (labelId: string) => React.ReactNode;
};

function ControlRow({ label, help, locked, children, className, ...props }: ControlRowProps) {
  const labelId = useId();
  return (
    <div
      data-slot="control-row"
      data-locked={locked ? true : undefined}
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    >
      <span id={labelId} className="text-caption font-semibold text-fg-dim">
        {label}
      </span>
      {locked ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-body-sm text-fg-dim">
            <Icon name="lock" label="Locked" />
            <span>{locked.value}</span>
          </span>
          <small className="text-caption text-fg-faint">{locked.reason}</small>
        </>
      ) : (
        <>
          {children?.(labelId)}
          {help ? <small className="text-caption text-fg-dim">{help}</small> : null}
        </>
      )}
    </div>
  );
}

type LockedReasonProps = React.ComponentProps<"p">;

function LockedReason({ className, children, ...props }: LockedReasonProps) {
  return (
    <p
      data-slot="locked-reason"
      className={cn("m-0 inline-flex items-start gap-1.5 text-caption text-fg-faint", className)}
      {...props}
    >
      <Icon name="lock" size="xs" className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

export { ControlRow, type ControlRowProps, LockedReason };
