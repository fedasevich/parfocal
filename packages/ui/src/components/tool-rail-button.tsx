import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { useKeyLabel } from "@parfocal/ui/components/keycap";
import { Tooltip, TooltipContent, TooltipTrigger } from "@parfocal/ui/components/tooltip";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ToolRailButtonProps = Omit<TogglePrimitive.Props, "children"> & {
  icon: IconName;
  label: string;
  keyHint?: string;
  action?: string;
  ai?: boolean;
  state?: "hover";
  tipSide?: "right" | "top";
};

function ToolRailButton({
  icon,
  label,
  keyHint: written,
  action,
  ai = false,
  state,
  tipSide = "right",
  className,
  ...props
}: ToolRailButtonProps) {
  const keyHint = useKeyLabel(action, written);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TogglePrimitive
            data-slot="tool-rail-button"
            data-ai={ai || undefined}
            data-state={state}
            aria-label={keyHint ? `${label} (${keyHint})` : label}
            className={cn(
              "group relative grid size-9.5 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent text-fg-dim outline-none hover:bg-chrome-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent data-[state=hover]:bg-chrome-2 data-[state=hover]:text-fg data-pressed:bg-accent-fill data-pressed:text-on-accent",
              ai &&
                "before:absolute before:top-0.75 before:left-0.75 before:size-1.25 before:rounded-full before:bg-(--accent) before:content-[''] data-pressed:before:bg-on-accent",
              className,
            )}
            {...props}
          />
        }
      >
        <Icon name={icon} size="md" />
        {keyHint ? (
          <span
            aria-hidden="true"
            data-shifted={keyHint.startsWith("⇧") || undefined}
            className="absolute right-0.5 bottom-px font-mono text-[8px] leading-none font-medium text-fg-faint group-data-pressed:text-on-accent group-data-pressed:opacity-80 data-shifted:before:content-['⇧']"
          >
            {keyHint.replace(/^⇧/, "")}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side={tipSide}>
        {label}
        {keyHint ? ` · ${keyHint}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolRail({
  className,
  layout = "rail",
  ...props
}: React.ComponentProps<"div"> & { layout?: "rail" | "dock" }) {
  return (
    <div
      data-slot="tool-rail"
      data-layout={layout}
      role="toolbar"
      aria-orientation={layout === "dock" ? "horizontal" : "vertical"}
      aria-label="Tools"
      className={cn(
        layout === "dock"
          ? "absolute bottom-3.5 left-1/2 z-6 flex -translate-x-1/2 items-center gap-0.5 rounded-zone border border-line bg-chrome p-1.25 shadow-pop"
          : "flex w-13 flex-col items-center gap-0.5 border-r border-line bg-chrome py-2",
        className,
      )}
      {...props}
    />
  );
}

function ToolRailGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tool-rail-group"
      className={cn(
        "flex w-10 flex-col items-center gap-0.5 border-b border-line py-1 last-of-type:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

export { ToolRail, ToolRailButton, type ToolRailButtonProps, ToolRailGroup };
