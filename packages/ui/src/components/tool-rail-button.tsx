import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@parfocal/ui/components/tooltip";
import { cn } from "cn";
import type * as React from "react";

type ToolRailButtonProps = Omit<TogglePrimitive.Props, "children"> & {
  icon: IconName;
  label: string;
  keyHint?: string;
  ai?: boolean;
  state?: "hover";
};

function ToolRailButton({
  icon,
  label,
  keyHint,
  ai = false,
  state,
  className,
  ...props
}: ToolRailButtonProps) {
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
              "group relative grid size-9.5 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent text-fg-dim outline-none hover:bg-chrome-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent data-[state=hover]:bg-chrome-2 data-[state=hover]:text-fg data-pressed:bg-accent-fill data-pressed:text-on-accent",
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
            className="absolute right-0.5 bottom-px font-mono text-[8px] leading-none font-medium text-fg-faint group-data-pressed:text-on-accent"
          >
            {keyHint}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {keyHint ? ` · ${keyHint}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolRail({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tool-rail"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Tools"
      className={cn(
        "flex w-13 flex-col items-center gap-0.5 border-r border-line bg-chrome py-2",
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
