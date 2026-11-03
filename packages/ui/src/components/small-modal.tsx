import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  BeforeYouList,
  type Blocker,
  blockerReason,
} from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type SmallModalWidth = 480 | 560;

const firstFieldSelector =
  'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="combobox"]:not([aria-disabled="true"]), [role="radio"][tabindex="0"], [contenteditable="true"]';

const ownEnterSelector =
  'textarea, button, a[href], select, summary, [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [role="radio"], [role="tab"], [contenteditable="true"]';

type SmallModalProps = Omit<DialogPrimitive.Root.Props, "children"> & {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  width?: SmallModalWidth;
  trigger?: React.ReactElement;
  hint?: React.ReactNode;
  primaryLabel: React.ReactNode;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  blockers?: Blocker[];
  blockersTitle?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  onCancel?: () => void;
  secondaryAction?: React.ReactNode;
  footerStart?: React.ReactNode;
  children?: React.ReactNode;
};

function SmallModal({
  title,
  subtitle,
  width = 480,
  trigger,
  hint,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryBusy = false,
  blockers = [],
  blockersTitle = "Before you can",
  cancelLabel = "Cancel",
  showCancel = true,
  onCancel,
  secondaryAction,
  footerStart,
  children,
  ...props
}: SmallModalProps) {
  const blocked = blockers.length > 0;
  const off = primaryDisabled || blocked || primaryBusy;
  const reason = blockerReason(blockers);
  const whyId = React.useId();
  const listId = `${whyId}-list`;
  const reasonId = `${whyId}-reason`;
  const describedBy = blockers.length > 1 ? listId : reason ? reasonId : undefined;
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const primaryRef = React.useRef<HTMLButtonElement>(null);

  const focusStart = () => {
    const field = bodyRef.current?.querySelector<HTMLElement>(firstFieldSelector);
    if (field) return field;
    if (!off && primaryRef.current) return primaryRef.current;
    return true;
  };

  const runPrimaryOnEnter = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.altKey || event.shiftKey || off) return;
    const modified = event.metaKey || event.ctrlKey;
    const ownsEnter = (event.target as HTMLElement).closest(ownEnterSelector) !== null;
    if (ownsEnter && !modified) return;
    event.preventDefault();
    onPrimary?.();
  };

  return (
    <DialogPrimitive.Root {...props}>
      {trigger ? <DialogPrimitive.Trigger render={trigger} /> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim duration-100 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup
          data-slot="small-modal"
          data-width={width}
          style={{ width }}
          initialFocus={focusStart}
          onKeyDown={runPrimaryOnEnter}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-48px)] max-w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[14px] border border-line bg-surf-panel text-body-sm text-fg shadow-pop outline-none duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
        >
          <div className="flex items-start gap-3 px-5 pt-5">
            <div className="grid min-w-0 flex-1 gap-1">
              <DialogPrimitive.Title className="m-0 text-title-sm leading-[1.3] font-semibold text-fg">
                {title}
              </DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="m-0 text-body-sm leading-[1.45] text-fg-dim">
                  {subtitle}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2" />}
              aria-label="Close"
            >
              <Icon name="close" />
            </DialogPrimitive.Close>
          </div>
          <div ref={bodyRef} className="grid min-h-0 content-start gap-5 overflow-auto p-5">
            {children}
          </div>
          <div className="border-t border-line">
            {blockers.length > 1 ? (
              <div className="px-5 pt-3.5">
                <BeforeYouList id={listId} title={blockersTitle} blockers={blockers} />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
              <div className="grid min-w-0 flex-1 gap-2 text-body-sm leading-[1.45] text-fg-dim">
                {footerStart}
                {reason ? <span id={reasonId}>{reason}</span> : hint}
              </div>
              {showCancel && onCancel ? (
                <Button variant="ghost" onClick={onCancel}>
                  {cancelLabel}
                </Button>
              ) : showCancel ? (
                <DialogPrimitive.Close render={<Button />}>
                  {cancelLabel}
                  <Keycap keys="Esc" size="sm" />
                </DialogPrimitive.Close>
              ) : null}
              {secondaryAction}
              <Button
                ref={primaryRef}
                variant="primary"
                disabled={off}
                aria-describedby={describedBy}
                onClick={onPrimary}
              >
                {primaryBusy ? (
                  <span
                    aria-hidden="true"
                    className="size-3 animate-spin rounded-full border-2 border-white/35 border-t-on-accent"
                  />
                ) : null}
                {primaryLabel}
                <Keycap keys="↵" size="sm" />
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type SmallModalZoneProps = Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
};

function SmallModalZone({ title, className, children, ...props }: SmallModalZoneProps) {
  return (
    <section
      data-slot="small-modal-zone"
      className={cn("grid min-w-0 gap-3", className)}
      {...props}
    >
      {title ? (
        <h3 className="m-0 flex items-center gap-2 text-body-sm font-semibold text-fg">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

export { SmallModal, type SmallModalProps, type SmallModalWidth, SmallModalZone };
