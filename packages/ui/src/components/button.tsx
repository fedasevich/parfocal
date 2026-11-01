import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-ctl border font-medium leading-none whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=focus]:outline-2 data-[state=focus]:outline-offset-2 data-[state=focus]:outline-accent active:not-aria-[haspopup]:translate-y-px data-[state=pressed]:translate-y-px disabled:cursor-not-allowed aria-disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        secondary:
          "border-line-strong bg-btn-bg text-fg hover:not-disabled:border-fg-faint data-[state=hover]:border-fg-faint disabled:opacity-45 aria-disabled:opacity-45 aria-expanded:border-fg-faint",
        default:
          "border-line-strong bg-btn-bg text-fg hover:not-disabled:border-fg-faint data-[state=hover]:border-fg-faint disabled:opacity-45 aria-disabled:opacity-45 aria-expanded:border-fg-faint",
        outline:
          "border-line-strong bg-btn-bg text-fg hover:not-disabled:border-fg-faint data-[state=hover]:border-fg-faint disabled:opacity-45 aria-disabled:opacity-45 aria-expanded:border-fg-faint",
        primary:
          "border-accent-fill bg-accent-fill text-on-accent hover:not-disabled:border-transparent hover:not-disabled:bg-[color-mix(in_srgb,var(--accent-fill)_86%,#fff)] data-[state=hover]:bg-[color-mix(in_srgb,var(--accent-fill)_86%,#fff)] data-[state=pressed]:brightness-90 disabled:border-transparent disabled:bg-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)] disabled:text-fg-dim aria-disabled:border-transparent aria-disabled:bg-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)] aria-disabled:text-fg-dim",
        ghost:
          "border-transparent bg-transparent text-fg-dim hover:not-disabled:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] hover:not-disabled:text-fg data-[state=hover]:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] data-[state=hover]:text-fg aria-expanded:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] aria-expanded:text-fg disabled:opacity-45",
        selected: "border-accent bg-accent-soft text-fg [&_svg]:text-accent",
        destructive:
          "border-transparent bg-bad/15 text-bad hover:not-disabled:bg-bad/25 disabled:opacity-45",
        link: "h-auto border-transparent bg-transparent px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 text-body-sm",
        md: "h-8 px-3 text-body-sm",
        xs: "h-6 gap-1 px-2 text-caption [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-caption",
        lg: "h-10 gap-2 px-4 text-body",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-10 p-0",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
      block: false,
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    state?: "hover" | "pressed" | "focus";
  };

function Button({ className, variant, size, block, state, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? "secondary"}
      data-state={state}
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  );
}

export { Button, type ButtonProps, buttonVariants };
