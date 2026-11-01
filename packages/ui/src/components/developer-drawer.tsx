import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Switch } from "@parfocal/ui/components/switch";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type DeveloperDrawerProps = Omit<React.ComponentProps<"div">, "title"> & {
  nav: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
};

function DeveloperDrawer({
  nav,
  footer,
  onClose,
  className,
  children,
  ...props
}: DeveloperDrawerProps) {
  return (
    <div
      data-slot="developer-drawer"
      role="dialog"
      aria-label="Developer"
      className={cn(
        "absolute top-11 right-0 bottom-0 z-[8] grid w-[720px] max-w-full grid-rows-[auto_minmax(0,1fr)_auto] border-l border-line bg-surf-panel text-body-sm text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5 border-b border-line py-3 pr-3 pl-4.5">
        <div className="grid min-w-0 gap-0.5">
          <b className="flex items-center gap-2 text-[16px] font-semibold">
            Developer
            <span className="rounded-[3px] bg-bad-fill px-1.5 font-mono text-label leading-4 font-semibold tracking-[0.05em] text-white">
              LAB
            </span>
          </b>
          <small className="text-body-sm leading-[1.45] text-fg-dim">
            Hidden from doctors. Opens with ⌃⇧D or <span className="font-mono">?lab</span>
          </small>
        </div>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="Close developer mode" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div className="grid min-h-0 grid-cols-[188px_minmax(0,1fr)]">
        {nav}
        <div className="grid min-h-0 content-start gap-5 overflow-y-auto px-4.5 pt-4.5 pb-6 [scrollbar-gutter:stable]">
          {children}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4.5 py-2 font-mono text-caption text-fg-dim">
        {footer}
      </div>
    </div>
  );
}

type DeveloperNavGroup = { title: string; items: { value: string; label: string }[] };

type DeveloperNavProps = Omit<React.ComponentProps<"nav">, "onChange"> & {
  groups: DeveloperNavGroup[];
  value: string;
  onValueChange: (value: string) => void;
};

function DeveloperNav({ groups, value, onValueChange, className, ...props }: DeveloperNavProps) {
  return (
    <nav
      data-slot="developer-nav"
      aria-label="Developer sections"
      className={cn(
        "flex flex-col gap-0.5 overflow-y-auto border-r border-line bg-surf-section px-2 py-3",
        className,
      )}
      {...props}
    >
      {groups.map((group, index) => (
        <div key={group.title} className="contents">
          <div
            className={cn(
              "px-2.5 pb-1.5 text-caption font-semibold text-fg-dim",
              index === 0 ? "pt-1" : "pt-3.5",
            )}
          >
            {group.title}
          </div>
          {group.items.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-current={item.value === value ? "true" : undefined}
              onClick={() => onValueChange(item.value)}
              className={cn(
                "cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1.75 text-left text-body-sm leading-tight text-fg-dim outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
                item.value === value && "bg-chrome-3 font-medium text-fg",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

type DevZoneProps = React.ComponentProps<typeof Zone> & { off?: boolean; note?: React.ReactNode };

function DevZone({ off = false, note, className, children, ...props }: DevZoneProps) {
  return (
    <Zone
      data-off={off || undefined}
      className={cn("p-4", off && "[&_h3]:text-fg-dim", className)}
      {...props}
    >
      <div
        role="group"
        aria-disabled={off || undefined}
        className={cn("grid gap-(--space-in)", off && "pointer-events-none opacity-42")}
      >
        {children}
      </div>
      {note ? <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">{note}</p> : null}
    </Zone>
  );
}

type DevRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
};

function DevRow({ label, hint, disabled = false, className, children, ...props }: DevRowProps) {
  return (
    <div
      data-slot="dev-row"
      data-disabled={disabled || undefined}
      className={cn("grid min-h-8 grid-cols-[128px_minmax(0,1fr)] items-center gap-3", className)}
      {...props}
    >
      <span className="text-fg-dim">{label}</span>
      <div
        role="group"
        aria-disabled={disabled || undefined}
        className={cn(
          "grid min-w-0 justify-items-start gap-1.5",
          disabled && "pointer-events-none opacity-42",
        )}
      >
        {children}
        {hint ? <span className="text-body-sm leading-[1.45] text-fg-dim">{hint}</span> : null}
      </div>
    </div>
  );
}

type DevToggleProps = {
  label: React.ReactNode;
  sub?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function DevToggle({ label, sub, checked, onCheckedChange }: DevToggleProps) {
  return (
    <label
      data-slot="dev-toggle"
      className="grid min-h-7.5 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
    >
      <span>
        {label}
        {sub ? (
          <small className="mt-px block text-body-sm leading-[1.45] text-fg-dim">{sub}</small>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function DevFigures({ items }: { items: [string, string][] }) {
  return (
    <div data-slot="dev-figures" className="grid auto-cols-fr grid-flow-col gap-2">
      {items.map(([value, label]) => (
        <div
          key={label}
          className="grid min-w-0 gap-0.5 rounded-ctl border border-line bg-surf-panel px-2.5 py-2"
        >
          <b className="font-mono text-[16px] leading-tight font-semibold text-fg">{value}</b>
          <span className="truncate text-caption text-fg-faint">{label}</span>
        </div>
      ))}
    </div>
  );
}

function DevStatus({
  live = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { live?: boolean }) {
  return (
    <div
      data-slot="dev-status"
      className={cn("flex items-center gap-2 font-mono text-caption text-fg-dim", className)}
      {...props}
    >
      {live ? <i className="size-2 shrink-0 rounded-full bg-ok" /> : null}
      {children}
    </div>
  );
}

type HudBox = [string, [string, string][]];

function HudReadouts({ boxes }: { boxes: HudBox[] }) {
  return (
    <div
      data-slot="hud-readouts"
      className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 font-mono text-caption"
    >
      {boxes.map(([title, rows]) => (
        <div
          key={title}
          className="grid content-start gap-0.5 rounded-ctl border border-line bg-surf-panel px-2.5 py-2"
        >
          <b className="font-medium text-fg">{title}</b>
          {rows.map(([key, value]) => (
            <span key={key} className="flex justify-between gap-2 text-fg">
              <i className="not-italic text-fg-faint">{key}</i>
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

type PerformanceHudProps = React.ComponentProps<"div"> & {
  route: string;
  summary: string;
  lines: [string, string][];
};

function PerformanceHud({ route, summary, lines, className, ...props }: PerformanceHudProps) {
  return (
    <div
      data-slot="performance-hud"
      role="group"
      aria-label="Performance HUD"
      className={cn(
        "absolute top-14 left-16 z-[6] w-[230px] rounded-[10px] border border-line bg-chrome px-2.5 py-2 font-mono text-caption leading-[1.55] text-fg-dim shadow-pop",
        className,
      )}
      {...props}
    >
      <b className="font-medium text-fg">{route}</b> · {summary}
      {lines.map(([key, value]) => (
        <span key={key} className="block">
          <i className="text-fg-faint">{key}</i> {value}
        </span>
      ))}
    </div>
  );
}

export {
  DeveloperDrawer,
  type DeveloperDrawerProps,
  DeveloperNav,
  type DeveloperNavGroup,
  DevFigures,
  DevRow,
  DevStatus,
  DevToggle,
  DevZone,
  type HudBox,
  HudReadouts,
  PerformanceHud,
};
