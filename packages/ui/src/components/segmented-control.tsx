import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SegmentOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps = Omit<RadioGroupPrimitive.Props, "children"> & {
  options: SegmentOption[];
  fill?: boolean;
  size?: "md" | "lg";
  wrap?: boolean;
};

function SegmentedControl({
  options,
  fill = false,
  size = "md",
  wrap = false,
  className,
  ...props
}: SegmentedControlProps) {
  return (
    <RadioGroupPrimitive
      data-slot="segmented-control"
      className={cn(
        "min-w-0 items-stretch gap-0.5 rounded-ctl bg-seg-track p-0.5",
        fill ? "flex" : "inline-flex",
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioPrimitive.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled ?? false}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-3 text-center leading-tight font-medium whitespace-nowrap text-fg-dim outline-none hover:not-data-checked:not-data-disabled:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent data-checked:bg-accent-soft data-checked:font-semibold data-checked:text-fg data-checked:shadow-[inset_0_0_0_1.5px_var(--accent)] data-disabled:cursor-not-allowed data-disabled:opacity-40",
            size === "lg" ? "min-h-9.5 text-body" : "min-h-6.5 text-caption",
            fill && "flex-auto px-2.5 py-1",
          )}
        >
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}

export { SegmentedControl, type SegmentedControlProps, type SegmentOption };
