import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";

type DrawerPanelProps = {
  label: string;
  title: string;
  hint?: ReactNode;
  width: number;
  onClose: () => void;
  footer?: ReactNode;
  scrim?: boolean;
  children: ReactNode;
  testId?: string;
};

function DrawerPanel({
  label,
  title,
  hint,
  width,
  onClose,
  footer,
  scrim = true,
  children,
  testId,
}: DrawerPanelProps) {
  const { t } = useLingui();

  const body = (
    <>
      <div
        className={cn(
          "flex flex-none items-center gap-2.5 border-b border-line",
          scrim ? "px-6 py-4" : "px-4.5 py-3.5",
        )}
      >
        <b className={cn("min-w-0 truncate", scrim ? "text-title-sm" : "text-body")}>{title}</b>
        {hint ? <span className="min-w-0 truncate text-body-sm text-fg-dim">{hint}</span> : null}
        <span className="flex-1" />
        <Button size="icon" variant="ghost" aria-label={t`Close`} onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div
        data-slot="drawer-body"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain",
          scrim ? "content-start p-6" : "px-4.5 py-4",
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line px-4.5 py-3">
          {footer}
        </div>
      ) : null}
    </>
  );

  if (!scrim) {
    return (
      <aside
        role="dialog"
        aria-label={label}
        data-testid={testId}
        className="absolute top-0 right-0 bottom-0 z-12 flex max-h-full max-w-full flex-col border-l border-line bg-chrome shadow-pop"
        style={{ width }}
      >
        {body}
      </aside>
    );
  }

  return (
    <SheetPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPrimitive.Portal>
        <SheetPrimitive.Backdrop
          data-slot="drawer-overlay"
          className="fixed inset-0 z-40 bg-[rgb(0_0_0/0.25)]"
        />
        <SheetPrimitive.Popup
          aria-label={label}
          data-testid={testId}
          data-slot="drawer-panel"
          className="fixed top-0 right-0 bottom-0 z-41 flex h-dvh max-h-dvh max-w-full flex-col border-l border-line bg-surf-panel text-body-sm shadow-pop outline-none"
          style={{ width }}
        >
          {body}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}

export { DrawerPanel, type DrawerPanelProps };
