import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";

type NumberStepperProps = NumberFieldPrimitive.Root.Props & {
  label: string;
};

function NumberStepper({ label, className, ...props }: NumberStepperProps) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-stepper"
      className={cn("inline-flex", className)}
      {...props}
    >
      <NumberFieldPrimitive.Group className="inline-flex items-center gap-0.5 rounded-ctl border border-line-strong bg-surf-field p-0.5">
        <NumberFieldPrimitive.Decrement
          aria-label={`Lower ${label}`}
          className="grid size-6 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-dim hover:not-disabled:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] hover:not-disabled:text-fg disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon name="minus" size="xs" />
        </NumberFieldPrimitive.Decrement>
        <NumberFieldPrimitive.Input
          aria-label={label}
          className="w-6 border-0 bg-transparent p-0 text-center text-body-sm font-semibold text-fg outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        />
        <NumberFieldPrimitive.Increment
          aria-label={`Raise ${label}`}
          className="grid size-6 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-dim hover:not-disabled:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] hover:not-disabled:text-fg disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon name="plus" size="xs" />
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}

export { NumberStepper, type NumberStepperProps };
