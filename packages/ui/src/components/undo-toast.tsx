import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "cn";
import type * as React from "react";
import { useEffect, useState } from "react";

type ToastProps = React.ComponentProps<"div">;

function Toast({ className, ...props }: ToastProps) {
  return (
    <div
      data-slot="toast"
      role="status"
      className={cn(
        "inline-flex items-center gap-3.5 rounded-ctl border border-accent bg-chrome px-3.5 py-2 text-body-sm whitespace-nowrap text-fg shadow-pop",
        className,
      )}
      {...props}
    />
  );
}

type UndoToastProps = Omit<ToastProps, "children"> & {
  message: React.ReactNode;
  onUndo?: () => void;
  duration?: number;
  onExpire?: () => void;
};

function UndoToast({ message, onUndo, duration = 4000, onExpire, ...props }: UndoToastProps) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setShown(false);
      onExpire?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onExpire]);
  if (!shown) return null;
  return (
    <Toast data-undo="" {...props}>
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          onUndo?.();
          setShown(false);
        }}
        className="inline-flex cursor-pointer items-center gap-1.25 border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Icon name="undo" />
        Undo
      </button>
    </Toast>
  );
}

export { Toast, type ToastProps, UndoToast, type UndoToastProps };
