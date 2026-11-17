import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Dialog, DialogClose, DialogContent } from "@parfocal/ui/components/dialog";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

type SettingScopeKind = "personal" | "device" | "lab";

const scopes: Record<SettingScopeKind, { icon: IconName; label: MessageDescriptor }> = {
  personal: { icon: "flag", label: msg`Personal` },
  device: { icon: "monitor", label: msg`This computer` },
  lab: { icon: "lock", label: msg`Set by your lab` },
};

function SettingScope({
  scope,
  iconOnly = false,
  className,
}: {
  scope: SettingScopeKind;
  iconOnly?: boolean;
  className?: string;
}) {
  const { t } = useLingui();

  const { icon, label } = scopes[scope];
  if (iconOnly) {
    return (
      <span
        data-slot="setting-scope"
        data-scope={scope}
        role="img"
        aria-label={t(label)}
        title={t(label)}
        className={cn("inline-flex items-center text-fg-faint", className)}
      >
        <Icon name={icon} size="xs" />
      </span>
    );
  }
  return (
    <span
      data-slot="setting-scope"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-label text-fg-faint",
        className,
      )}
    >
      <Icon name={icon} size="xs" />
      {t(label)}
    </span>
  );
}

function SettingsScopeLegend() {
  return (
    <div
      data-slot="settings-scope-legend"
      className="mt-auto flex flex-col gap-1.5 border-t border-line px-2.5 pt-3"
    >
      <span className="text-caption font-medium text-fg-faint">
        <Trans>Who a setting applies to</Trans>
      </span>
      {(Object.keys(scopes) as SettingScopeKind[]).map((scope) => (
        <SettingScope key={scope} scope={scope} />
      ))}
    </div>
  );
}

type SettingsDialogProps = {
  open?: boolean;
  modal?: boolean;
  onOpenChange?: React.ComponentProps<typeof Dialog>["onOpenChange"];
  title: React.ReactNode;
  hint?: React.ReactNode;
  nav: React.ReactNode;
  closeLabel?: string;
  children: React.ReactNode;
};

function SettingsDialog({
  open = true,
  modal = true,
  onOpenChange,
  title,
  hint,
  nav,
  closeLabel = t`Close settings`,
  children,
}: SettingsDialogProps) {
  const { t } = useLingui();

  return (
    <Dialog
      open={open}
      modal={modal}
      disablePointerDismissal={!modal}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <DialogContent
        showCloseButton={false}
        aria-label={t`Settings`}
        className="grid h-[min(720px,calc(100vh-2rem))] w-[960px] max-w-[calc(100vw-2rem)] grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-stretch gap-0 overflow-hidden rounded-[14px] border-line bg-chrome p-0 text-body-sm text-fg sm:max-w-[calc(100vw-2rem)]"
      >
        {nav}
        <div
          data-slot="settings-main"
          className="flex min-h-0 flex-col gap-4 overflow-y-auto px-8 pb-8 [scrollbar-gutter:stable]"
        >
          <div className="sticky top-0 z-[2] flex items-center gap-3 bg-chrome pt-5.5 pb-3">
            <h2 className="m-0 text-title font-semibold">{title}</h2>
            {hint ? <span className="text-caption text-fg-faint">{hint}</span> : null}
            <span className="flex-1" />
            <DialogClose render={<Button variant="ghost" size="icon" aria-label={closeLabel} />}>
              <Icon name="close" />
            </DialogClose>
          </div>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SettingsNavProps = React.ComponentProps<"nav"> & {
  query: string;
  onQueryChange: (query: string) => void;
  group?: React.ReactNode;
  empty?: React.ReactNode;
};

function SettingsNav({
  query,
  onQueryChange,
  group = t`Preferences`,
  empty,
  className,
  children,
  ...props
}: SettingsNavProps) {
  const { t } = useLingui();

  return (
    <nav
      data-slot="settings-nav"
      aria-label={t`Settings sections`}
      className={cn(
        "flex min-h-0 flex-col gap-0.5 overflow-y-auto bg-chrome-2 px-3 py-4",
        className,
      )}
      {...props}
    >
      <label className="mb-4 flex h-8 pointer-coarse:min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-chrome px-2.5 text-fg-faint focus-within:border-accent">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t`Search settings`}
          aria-label={t`Search settings`}
          className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-fg outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <span className="px-2.5 pb-1.5 text-caption font-medium text-fg-faint">{group}</span>
      {children}
      {empty ? <span className="px-2.5 py-1.5 text-caption text-fg-faint">{empty}</span> : null}
    </nav>
  );
}

type SettingsNavItemProps = Omit<React.ComponentProps<"button">, "children"> & {
  icon: IconName;
  label: React.ReactNode;
  current?: boolean;
  count?: number | undefined;
};

function SettingsNavItem({
  icon,
  label,
  current = false,
  count,
  className,
  ...props
}: SettingsNavItemProps) {
  return (
    <button
      type="button"
      data-slot="settings-nav-item"
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex h-8.5 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-body-sm text-fg-dim outline-none hover:bg-[color-mix(in_srgb,var(--chrome-3)_60%,transparent)] hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
        current && "cursor-default bg-chrome-3 font-medium text-fg hover:bg-chrome-3",
        className,
      )}
      {...props}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {count !== undefined ? (
        <b className="ml-auto text-caption font-medium text-fg-faint tabular-nums">{count}</b>
      ) : null}
    </button>
  );
}

function SettingsRows({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-rows"
      className={cn("flex flex-col gap-6 pt-1", className)}
      {...props}
    />
  );
}

function SettingNoteLabel({ label, note }: { label: React.ReactNode; note: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const pressing = useRef(false);

  useEffect(() => {
    if (!open) return;
    const closeFirst = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", closeFirst, true);
    return () => window.removeEventListener("keydown", closeFirst, true);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={120}
        data-slot="setting-note-trigger"
        aria-describedby={noteId}
        onPointerDown={() => {
          pressing.current = true;
        }}
        onPointerUp={() => {
          pressing.current = false;
        }}
        onFocus={() => {
          if (!pressing.current) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="inline-flex cursor-help items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-left outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
      >
        <b className="text-body font-medium text-fg">{label}</b>
        <Icon name="help" size="xs" className="text-fg-faint" data-slot="setting-note-glyph" />
      </PopoverTrigger>
      <span id={noteId} hidden>
        {note}
      </span>
      <PopoverContent
        data-slot="setting-note-popover"
        side="bottom"
        align="start"
        initialFocus={false}
        finalFocus={false}
        className="leading-[1.45] text-fg-dim"
      >
        {note}
      </PopoverContent>
    </Popover>
  );
}

const changeKeys = new Set([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

type SettingsRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  note?: React.ReactNode;
  noteHidden?: boolean;
  onControlChange?: () => void;
  scope: SettingScopeKind;
  fact?: boolean;
  children: React.ReactNode;
};

function SettingsRow({
  label,
  help,
  note,
  noteHidden = false,
  onControlChange,
  scope,
  fact = false,
  className,
  children,
  ...props
}: SettingsRowProps) {
  const folded = Boolean(note) && noteHidden;
  return (
    <div
      data-slot="settings-row"
      data-fact={fact || undefined}
      className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10 gap-y-2", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.75">
        <span className="inline-flex items-center gap-1.5">
          {folded ? (
            <SettingNoteLabel label={label} note={note} />
          ) : (
            <b className="text-body font-medium text-fg">{label}</b>
          )}
          <SettingScope scope={scope} iconOnly />
        </span>
        {note && !folded ? (
          <span data-slot="setting-note" className="text-body-sm leading-[1.45] text-fg-dim">
            {note}
          </span>
        ) : null}
        {help ? <span className="text-body-sm leading-[1.45] text-fg-dim">{help}</span> : null}
      </div>
      <div
        className="flex max-w-[440px] items-center justify-end"
        onPointerUpCapture={onControlChange}
        onKeyUpCapture={(event) => {
          if (changeKeys.has(event.key)) onControlChange?.();
        }}
      >
        {fact ? (
          <span className="flex flex-wrap justify-end gap-x-4 gap-y-1.5 text-body text-fg">
            {children}
          </span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

type SettingsFactProps = Omit<React.ComponentProps<"div">, "children"> & {
  icon: IconName;
  label: React.ReactNode;
  children: React.ReactNode;
};

function SettingsFact({ icon, label, className, children, ...props }: SettingsFactProps) {
  return (
    <div
      data-slot="settings-fact"
      className={cn(
        "grid grid-cols-[18px_140px_minmax(0,1fr)] items-center gap-3 border-b border-line py-2.5 text-body last:border-b-0",
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="text-fg-faint" />
      <span className="text-fg-dim">{label}</span>
      <span className="min-w-0 text-fg">{children}</span>
    </div>
  );
}

type SettingsEmptyProps = {
  query: string;
  onClear: () => void;
};

function SettingsEmpty({ query, onClear }: SettingsEmptyProps) {
  return (
    <div
      data-slot="settings-empty"
      className="grid justify-items-center gap-2 py-24 text-center text-body-sm text-fg-dim"
    >
      <Icon name="search" size="lg" className="text-fg-faint" />
      <b className="text-body font-medium text-fg">
        <Trans>Nothing matches "{query}"</Trans>
      </b>
      <span>
        <Trans>Try another word, for example zoom, names or preset.</Trans>
      </span>
      <Button onClick={onClear}>
        <Trans>Clear the search</Trans>
      </Button>
    </div>
  );
}

export {
  SettingScope,
  type SettingScopeKind,
  SettingsDialog,
  type SettingsDialogProps,
  SettingsEmpty,
  SettingsFact,
  SettingsNav,
  SettingsNavItem,
  SettingsRow,
  SettingsRows,
  SettingsScopeLegend,
};
