import { Button } from "@parfocal/ui/components/button";
import { Dialog, DialogClose, DialogContent } from "@parfocal/ui/components/dialog";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SettingScopeKind = "personal" | "device" | "lab";

const scopes: Record<SettingScopeKind, { icon: IconName; label: string }> = {
  personal: { icon: "flag", label: "Personal" },
  device: { icon: "monitor", label: "This computer" },
  lab: { icon: "lock", label: "Set by your lab" },
};

function SettingScope({ scope, className }: { scope: SettingScopeKind; className?: string }) {
  const { icon, label } = scopes[scope];
  return (
    <span
      data-slot="setting-scope"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-label text-fg-faint",
        className,
      )}
    >
      <Icon name={icon} size="xs" />
      {label}
    </span>
  );
}

function SettingsScopeLegend() {
  return (
    <div
      data-slot="settings-scope-legend"
      className="mt-auto flex flex-col gap-1.5 border-t border-line px-2.5 pt-3"
    >
      <span className="text-caption font-medium text-fg-faint">Who a setting applies to</span>
      {(Object.keys(scopes) as SettingScopeKind[]).map((scope) => (
        <SettingScope key={scope} scope={scope} />
      ))}
    </div>
  );
}

type SettingsDialogProps = {
  open?: boolean;
  onOpenChange?: React.ComponentProps<typeof Dialog>["onOpenChange"];
  title: React.ReactNode;
  hint?: React.ReactNode;
  nav: React.ReactNode;
  closeLabel?: string;
  children: React.ReactNode;
};

function SettingsDialog({
  open = true,
  onOpenChange,
  title,
  hint,
  nav,
  closeLabel = "Close settings",
  children,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} {...(onOpenChange ? { onOpenChange } : {})}>
      <DialogContent
        showCloseButton={false}
        aria-label="Settings"
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
  group = "Preferences",
  empty,
  className,
  children,
  ...props
}: SettingsNavProps) {
  return (
    <nav
      data-slot="settings-nav"
      aria-label="Settings sections"
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
          placeholder="Search settings"
          aria-label="Search settings"
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

type SettingsRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  scope: SettingScopeKind;
  fact?: boolean;
  children: React.ReactNode;
};

function SettingsRow({
  label,
  help,
  scope,
  fact = false,
  className,
  children,
  ...props
}: SettingsRowProps) {
  return (
    <div
      data-slot="settings-row"
      data-fact={fact || undefined}
      className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10 gap-y-2", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.75">
        <b className="text-body font-medium text-fg">{label}</b>
        {help ? <span className="text-body-sm leading-[1.45] text-fg-dim">{help}</span> : null}
        <SettingScope scope={scope} className="mt-0.75" />
      </div>
      <div className="flex max-w-[440px] items-center justify-end">
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
      <b className="text-body font-medium text-fg">Nothing matches "{query}"</b>
      <span>Try another word, for example zoom, names or preset.</span>
      <Button onClick={onClear}>Clear the search</Button>
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
