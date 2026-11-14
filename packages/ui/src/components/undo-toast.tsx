import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

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

function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.25 border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
    >
      <Icon name="undo" />
      Undo
    </button>
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
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setShown(false);
      expire.current?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration]);
  if (!shown) return null;
  return (
    <Toast data-undo="" {...props}>
      <span>{message}</span>
      <UndoButton
        onClick={() => {
          onUndo?.();
          setShown(false);
        }}
      />
    </Toast>
  );
}

const toastDurationMs = 1600;

type TimedToastProps = Omit<ToastProps, "children"> & {
  message: React.ReactNode;
  duration?: number;
  onExpire?: () => void;
};

function TimedToast({
  message,
  duration = toastDurationMs,
  onExpire,
  className,
  ...props
}: TimedToastProps) {
  const [shown, setShown] = useState(true);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setShown(false);
      expire.current?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration]);
  if (!shown) return null;
  return (
    <Toast
      data-timed=""
      className={cn("max-w-[min(480px,calc(100vw-32px))] whitespace-normal", className)}
      {...props}
    >
      <span>{message}</span>
    </Toast>
  );
}

export {
  TimedToast,
  type TimedToastProps,
  Toast,
  type ToastProps,
  toastDurationMs,
  UndoButton,
  UndoToast,
  type UndoToastProps,
};
