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
  scrim = false,
  children,
  testId,
}: DrawerPanelProps) {
  const panel = (
    <aside
      role="dialog"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "right-0 bottom-0 flex max-w-full flex-col border-l border-line shadow-pop",
        scrim ? "fixed top-0 z-41 bg-surf-panel" : "absolute top-0 z-12 bg-chrome",
      )}
      style={{ width }}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b border-line",
          scrim ? "px-6 py-4" : "px-4.5 py-3.5",
        )}
      >
        <b className={scrim ? "text-[18px]" : "text-body"}>{title}</b>
        {hint ? <span className="text-body-sm text-fg-dim">{hint}</span> : null}
        <span className="flex-1" />
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-auto",
          scrim ? "content-start p-6" : "px-4.5 py-4",
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex items-center gap-2 border-t border-line px-4.5 py-3">{footer}</div>
      ) : null}
    </aside>
  );
  if (!scrim) return panel;
  return (
    <>
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default border-0 bg-[rgb(0_0_0/0.25)]"
      />
      {panel}
    </>
  );
}

export { DrawerPanel, type DrawerPanelProps };
