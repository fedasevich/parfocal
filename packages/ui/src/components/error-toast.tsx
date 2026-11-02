import { Icon } from "@parfocal/ui/components/icon";
import type { ErrorAction, ErrorNotice } from "@parfocal/ui/lib/api-error";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const actionLabels: Record<ErrorAction, string> = {
  retry: "Try again",
  "sign-in": "Sign in again",
  reload: "Reload",
};

const toneClasses = {
  bad: "border-bad [&>svg]:text-bad",
  warn: "border-warn [&>svg]:text-warn",
};

type ErrorToastProps = Omit<React.ComponentProps<"div">, "title"> & {
  notice: Pick<ErrorNotice, "tone" | "title" | "message" | "action">;
  onAction?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
};

function ErrorToast({ notice, onAction, onDismiss, className, ...props }: ErrorToastProps) {
  return (
    <div
      data-slot="error-toast"
      data-tone={notice.tone}
      role="alert"
      className={cn(
        "flex w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-ctl border border-l-4 bg-chrome px-3.5 py-3 text-body-sm text-fg shadow-pop",
        toneClasses[notice.tone],
        className,
      )}
      {...props}
    >
      <Icon name="warn" className="mt-0.5" />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="m-0 font-semibold">{notice.title}</p>
        <p className="m-0 leading-[1.45] text-fg-dim">{notice.message}</p>
        {notice.action && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-1 w-fit cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {actionLabels[notice.action]}
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-fg-dim hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}

export { actionLabels, ErrorToast, type ErrorToastProps };
