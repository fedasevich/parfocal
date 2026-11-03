import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type JobWindowProps = Omit<DialogPrimitive.Root.Props, "children"> & {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  footer: React.ReactNode;
  width?: number;
  className?: string;
  children?: React.ReactNode;
};

function JobWindow({
  title,
  subtitle,
  footer,
  width = 560,
  className,
  children,
  ...props
}: JobWindowProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim duration-(--motion-fast) data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup
          data-slot="job-window"
          style={{ width }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100%-56px)] max-w-[calc(100%-56px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] border border-line bg-surf-panel text-body-sm text-fg shadow-pop outline-none duration-(--motion-fast) data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            className,
          )}
        >
          <div className="flex items-center gap-4 border-b border-line px-(--pad-modal) py-4.5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <DialogPrimitive.Title className="m-0 truncate text-title-sm font-semibold text-fg">
                {title}
              </DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="m-0 text-body-sm text-fg-dim">
                  {subtitle}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon" className="-mr-2" />}
              aria-label="Close"
            >
              <Icon name="close" />
            </DialogPrimitive.Close>
          </div>
          <div className="grid min-h-0 content-start gap-(--space-zone) overflow-auto p-(--pad-modal)">
            {children}
          </div>
          <div className="flex items-center gap-2 border-t border-line px-(--pad-modal) py-3.5">
            {footer}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { JobWindow, type JobWindowProps };
