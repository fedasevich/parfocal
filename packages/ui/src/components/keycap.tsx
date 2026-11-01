import { cn } from "@parfocal/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

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

type KeycapProps = Omit<React.ComponentProps<"kbd">, "children"> &
  VariantProps<typeof keycapVariants> & {
    keys: string;
  };

function Keycap({ keys, size, className, ...props }: KeycapProps) {
  return (
    <kbd data-slot="keycap" className={cn(keycapVariants({ size }), className)} {...props}>
      {keys}
    </kbd>
  );
}

export { Keycap, type KeycapProps, keycapVariants };
