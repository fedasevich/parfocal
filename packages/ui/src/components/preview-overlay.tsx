import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import type { ReactNode } from "react";

type PreviewOverlayProps = {
  label: string;
  title: string;
  meta?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

function PreviewOverlay({
  label,
  title,
  meta,
  closeLabel,
  onClose,
  children,
}: PreviewOverlayProps) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="fixed inset-0 z-40 grid grid-rows-[auto_minmax(0,1fr)] bg-scrim"
    >
      <div className="flex items-center gap-3 border-b border-line bg-chrome px-5 py-2.5 text-body-sm">
        <Icon name="file" />
        <b className="truncate">{title}</b>
        {meta ? <span className="truncate text-fg-dim">{meta}</span> : null}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div className="grid justify-center overflow-auto p-8">{children}</div>
    </div>
  );
}

export { PreviewOverlay, type PreviewOverlayProps };
