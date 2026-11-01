import type { Decision } from "@parfocal/tokens";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type GalleryTileState = "to-check" | "current" | "done";

const dotColors: Record<Decision, string> = {
  agree: "bg-v-agree",
  disagree: "bg-v-disagree",
  unsure: "bg-v-unsure",
  open: "bg-chrome shadow-[0_0_0_2px_var(--chrome),inset_0_0_0_1.5px_var(--fg-faint)]",
};

type GalleryTileProps = Omit<React.ComponentProps<"button">, "children"> & {
  image: string;
  objectId: string;
  label: string;
  size?: 40 | 92 | 120;
  state?: GalleryTileState;
  decision?: Decision;
  dimmed?: boolean;
  ringed?: boolean;
  imagePosition?: string | undefined;
  imageSize?: string | undefined;
  outline?: React.ReactNode;
};

function GalleryTile({
  image,
  objectId,
  label,
  size = 92,
  state = "to-check",
  decision = "open",
  dimmed = false,
  ringed = false,
  imagePosition,
  imageSize,
  outline,
  className,
  ...props
}: GalleryTileProps) {
  const crop = size === 40;
  return (
    <button
      type="button"
      data-slot="gallery-tile"
      data-state={state}
      aria-pressed={state === "current"}
      aria-label={`${objectId}, ${label}, ${decision === "open" ? "open" : decision}`}
      className={cn(
        "group/tile relative block cursor-pointer border-0 bg-transparent p-0 text-fg outline-none",
        dimmed && "opacity-45",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "relative block rounded-md bg-[#111] bg-cover bg-center shadow-[inset_0_0_0_1px_var(--line)] group-hover/tile:shadow-[0_0_0_2px_var(--line-strong)] group-focus-visible/tile:shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_var(--accent)]",
          crop && "rounded-[5px]",
          state === "current" && "shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_var(--accent)]",
          ringed &&
            "shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_color-mix(in_srgb,var(--accent)_75%,white)]",
        )}
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${image})`,
          ...(imagePosition ? { backgroundPosition: imagePosition } : {}),
          ...(imageSize ? { backgroundSize: imageSize } : {}),
        }}
      >
        {outline ??
          (crop ? null : (
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-1/2 size-[42%] -translate-1/2 rounded-full border-[1.5px] border-dashed border-white/85"
            />
          ))}
        {crop ? null : (
          <span className="absolute bottom-1 left-1 rounded-[3px] bg-black/70 px-1 font-mono text-label leading-4 text-white">
            {objectId}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute -right-0.75 -bottom-0.75 size-2.5 rounded-full shadow-[0_0_0_2px_var(--chrome)]",
          dotColors[decision],
          state === "to-check" && decision === "open" && !crop && "hidden",
        )}
      />
    </button>
  );
}

export { GalleryTile, type GalleryTileProps, type GalleryTileState };
