import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useId } from "react";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 cursor-pointer rounded-full border border-line-strong bg-surf-field outline-none transition-colors duration-(--motion-fast) ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-accent disabled:cursor-not-allowed data-disabled:cursor-not-allowed data-disabled:opacity-40 aria-invalid:border-bad data-checked:border-accent-fill data-checked:bg-accent-fill",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-accent" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}

type RadioRowProps = Omit<React.ComponentProps<"label">, "title"> & {
  value: string;
  title: React.ReactNode;
  text?: React.ReactNode;
  disabled?: boolean;
};

function RadioRow({ value, title, text, disabled, className, ...props }: RadioRowProps) {
  const id = useId();
  return (
    <label
      data-slot="radio-row"
      data-disabled={disabled || undefined}
      className={cn(
        "group/radio-row flex cursor-pointer items-start gap-2.5 data-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <RadioGroupItem
        value={value}
        disabled={disabled ?? false}
        aria-labelledby={`${id}-title`}
        aria-describedby={text ? `${id}-text` : undefined}
        className="mt-0.5"
      />
      <span className="grid gap-0.5 peer-data-disabled:opacity-40 group-data-disabled/radio-row:opacity-40">
        <b id={`${id}-title`} className="text-body-sm font-semibold text-fg">
          {title}
        </b>
        {text ? (
          <small id={`${id}-text`} className="text-body-sm text-fg-dim">
            {text}
          </small>
        ) : null}
      </span>
    </label>
  );
}

export { RadioGroup, RadioGroupItem, RadioRow, type RadioRowProps };
