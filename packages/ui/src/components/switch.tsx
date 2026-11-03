import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@parfocal/ui/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 outline-none transition-colors duration-(--motion-fast) ease-standard after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-accent aria-invalid:outline-2 aria-invalid:outline-solid aria-invalid:outline-bad data-[size=default]:h-4 data-[size=default]:w-7 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-checked:bg-accent-fill data-unchecked:bg-chrome-3 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full transition-[translate,background-color] duration-(--motion-fast) ease-standard group-data-[size=default]/switch:size-3 group-data-[size=sm]/switch:size-2.5 data-checked:translate-x-3 data-checked:bg-on-accent data-unchecked:translate-x-0 data-unchecked:bg-fg-dim"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
