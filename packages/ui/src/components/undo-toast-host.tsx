import { Toast, UndoButton } from "@parfocal/ui/components/undo-toast";
import type { UndoToaster } from "@parfocal/ui/lib/undo-toaster";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useSyncExternalStore } from "react";

type UndoToastHostProps = React.ComponentProps<"div"> & {
  toaster: UndoToaster;
};

function UndoToastHost({ toaster, className, ...props }: UndoToastHostProps) {
  const shown = useSyncExternalStore(toaster.subscribe, toaster.current, toaster.current);
  return (
    <div
      data-slot="undo-toast-host"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-70 flex justify-center",
        className,
      )}
      {...props}
    >
      {shown === null ? null : (
        <Toast key={shown.id} className="pointer-events-auto">
          <span>{shown.message}</span>
          {shown.canUndo ? <UndoButton onClick={() => toaster.undo(shown.id)} /> : null}
        </Toast>
      )}
    </div>
  );
}

export { UndoToastHost, type UndoToastHostProps };
