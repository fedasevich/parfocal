import { cn } from "@parfocal/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const keycapVariants = cva(
  "inline-grid shrink-0 place-items-center rounded-sm border border-b-2 border-line-strong bg-chrome-2 font-mono font-medium leading-none text-fg-dim group-data-[variant=primary]/button:border-white/45 group-data-[variant=primary]/button:bg-transparent group-data-[variant=primary]/button:text-on-accent group-disabled/button:border-line-strong group-disabled/button:text-fg-dim",
  {
    variants: {
      size: {
        sm: "h-4 min-w-4 px-1 text-label group-data-[slot=button]/button:bg-transparent",
        md: "h-5 min-w-5 px-1.25 text-label",
        lg: "h-6 min-w-6 px-1.5 text-body-sm",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type KeyLabel = (action: string) => string | null | undefined;

const KeycapContext = React.createContext<KeyLabel | null>(null);

function KeycapBindings({ label, children }: { label: KeyLabel; children: React.ReactNode }) {
  return <KeycapContext value={label}>{children}</KeycapContext>;
}

function useKeyLabel(action: string | undefined, fallback?: string): string | null {
  const label = React.use(KeycapContext);
  if (action === undefined) return fallback ?? null;
  const bound = label?.(action);
  if (bound === undefined) return fallback ?? null;
  return bound === null || bound === "" ? null : bound;
}

type KeycapProps = Omit<React.ComponentProps<"kbd">, "children"> &
  VariantProps<typeof keycapVariants> & {
    keys?: string | undefined;
    action?: string | undefined;
  };

function Keycap({ keys, action, size, className, ...props }: KeycapProps) {
  const shown = useKeyLabel(action, keys);
  if (shown === null) return null;
  return (
    <kbd
      data-slot="keycap"
      data-action={action}
      className={cn(keycapVariants({ size }), className)}
      {...props}
    >
      {shown}
    </kbd>
  );
}

export { Keycap, KeycapBindings, type KeycapProps, type KeyLabel, keycapVariants, useKeyLabel };
