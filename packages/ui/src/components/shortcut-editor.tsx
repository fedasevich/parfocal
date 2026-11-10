import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const keyBindingVariants = cva(
  "inline-grid h-6.5 min-w-7 shrink-0 cursor-pointer place-items-center rounded-md border border-b-2 border-line-strong bg-chrome-2 px-2 font-mono text-caption font-medium text-fg outline-none hover:not-disabled:border-fg-dim focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent disabled:cursor-default disabled:opacity-60",
  {
    variants: {
      state: {
        default: "",
        mine: "border-accent bg-accent-soft text-accent",
        conflict: "border-bad text-bad",
        off: "text-fg-faint line-through",
        recording: "min-w-[110px] border-accent text-fg ring-2 ring-accent/40",
      },
      size: { md: "", sm: "pointer-events-none h-5 min-w-5 text-label" },
    },
    defaultVariants: { state: "default", size: "md" },
  },
);

type KeyBindingProps = React.ComponentProps<"button"> & VariantProps<typeof keyBindingVariants>;

function KeyBinding({ state, size, className, type = "button", ...props }: KeyBindingProps) {
  return (
    <button
      type={type}
      data-slot="key-binding"
      data-state={state ?? "default"}
      className={cn(keyBindingVariants({ state, size }), className)}
      {...props}
    />
  );
}

function AddKeyButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="add-key"
      title="Add another key for this action"
      aria-label="Add another key"
      className={cn(
        "size-6 cursor-pointer rounded-md border border-dashed border-line-strong bg-transparent text-body leading-none text-fg-faint opacity-0 group-hover/shortcut:opacity-100 focus-visible:opacity-100",
        className,
      )}
      {...props}
    >
      +
    </button>
  );
}

function UnboundKey({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="unbound-key"
      className={cn(
        "rounded-md border border-dashed border-bad px-1.75 py-0.75 text-caption text-bad",
        className,
      )}
      {...props}
    >
      no key
    </span>
  );
}

type ShortcutSource = "clin" | "fig" | "qp" | "new";

const sourceNames: Record<ShortcutSource, string> = {
  clin: "Sectra",
  fig: "Figma",
  qp: "QuPath",
  new: "ours",
};

type ShortcutRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  name: React.ReactNode;
  notes?: React.ReactNode[];
  keys: React.ReactNode;
  standard: React.ReactNode;
  source: ShortcutSource;
  highlight?: "found" | "recording" | undefined;
  card?: React.ReactNode;
};

function ShortcutRow({
  name,
  notes = [],
  keys,
  standard,
  source,
  highlight,
  card,
  className,
  ...props
}: ShortcutRowProps) {
  return (
    <div
      data-slot="shortcut-row"
      data-highlight={highlight}
      className={cn(
        "group/shortcut -mx-2 grid grid-cols-[minmax(0,1fr)_auto_150px_52px] items-center gap-3 rounded-[7px] px-2 py-1.25 text-body-sm hover:bg-chrome-2",
        highlight === "found" && "bg-accent-soft hover:bg-accent-soft",
        highlight === "recording" && "bg-chrome-2",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 text-fg">
        {name}
        {notes.map((note, index) => (
          <small key={index} className="block text-body-sm leading-[1.45] text-fg-dim">
            {note}
          </small>
        ))}
      </span>
      <span className="flex flex-wrap items-center justify-end gap-1.25">{keys}</span>
      <span className="flex items-center justify-end gap-2 text-caption text-fg-faint">
        {standard}
      </span>
      <span className="justify-self-end rounded-[3px] border border-line-strong px-1.25 py-px font-mono text-label font-medium text-fg-faint">
        {sourceNames[source]}
      </span>
      {card ? <div className="col-span-full">{card}</div> : null}
    </div>
  );
}

type ShortcutGroupProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode;
  where: React.ReactNode;
};

function ShortcutGroup({ title, where, className, children, ...props }: ShortcutGroupProps) {
  return (
    <section
      data-slot="shortcut-group"
      aria-label={typeof title === "string" ? title : undefined}
      className={cn("grid gap-0.5", className)}
      {...props}
    >
      <div className="mb-1 flex justify-between gap-3 text-caption">
        <h3 className="m-0 text-caption font-semibold text-fg-dim">{title}</h3>
        <span className="text-fg-dim">{where}</span>
      </div>
      {children}
    </section>
  );
}

type KeyCardProps = Omit<React.ComponentProps<"div">, "title"> & {
  tone: "recording" | "warn" | "bad";
  title: React.ReactNode;
  actions?: React.ReactNode;
  keys?: React.ReactNode;
};

function KeyCard({ tone, title, actions, keys, className, children, ...props }: KeyCardProps) {
  return (
    <div
      data-slot="key-card"
      data-tone={tone}
      role={tone === "recording" ? "status" : "alert"}
      className={cn(
        "grid gap-1.5 rounded-lg border border-line bg-chrome px-3 py-2.5 text-body-sm text-fg-dim",
        tone === "recording" && "border-accent",
        tone === "warn" && "border-[color-mix(in_srgb,var(--warn)_60%,transparent)] bg-warn-soft",
        tone === "bad" && "border-[color-mix(in_srgb,var(--bad)_60%,transparent)]",
        className,
      )}
      {...props}
    >
      <b className="text-body-sm text-fg">{title}</b>
      {children ? <span>{children}</span> : null}
      {actions ? <div className="mt-0.5 flex flex-wrap gap-1.5">{actions}</div> : null}
      {keys ? (
        <span className="flex items-center gap-1.5 text-caption text-fg-faint">{keys}</span>
      ) : null}
    </div>
  );
}

function KeyLegend({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="key-legend"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      <KeyBinding size="sm" tabIndex={-1} aria-hidden>
        J
      </KeyBinding>
      default
      <KeyBinding size="sm" state="mine" tabIndex={-1} aria-hidden>
        J
      </KeyBinding>
      changed by you
      <KeyBinding size="sm" state="conflict" tabIndex={-1} aria-hidden>
        J
      </KeyBinding>
      conflict
    </span>
  );
}

type KeyFinderProps = Omit<React.ComponentProps<"button">, "children"> & {
  listening: boolean;
  found?: string | undefined;
  onClear?: () => void;
};

function KeyFinder({ listening, found, onClear, className, ...props }: KeyFinderProps) {
  return (
    <span className={cn("relative flex min-w-0 flex-1", className)}>
      <button
        type="button"
        data-slot="key-finder"
        data-listening={listening || undefined}
        className={cn(
          "flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-ctl border border-line-strong bg-transparent px-2.5 text-left text-body-sm text-fg-dim outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
          listening && "border-accent text-fg shadow-[0_0_0_3px_var(--accent-soft)]",
        )}
        {...props}
      >
        <Icon name="search" />
        <span className="flex-1 truncate">
          {listening
            ? "Press any key to see what it does…"
            : found
              ? `What ${found} does`
              : "Search, or press a key to see what it does"}
        </span>
      </button>
      {found && onClear ? (
        <button
          type="button"
          onClick={onClear}
          title="Clear"
          aria-label="Clear the key"
          className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 cursor-pointer place-items-center border-0 bg-transparent p-0 text-fg-dim"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export {
  AddKeyButton,
  KeyBinding,
  type KeyBindingProps,
  KeyCard,
  KeyFinder,
  KeyLegend,
  keyBindingVariants,
  ShortcutGroup,
  ShortcutRow,
  type ShortcutSource,
  sourceNames,
  UnboundKey,
};
