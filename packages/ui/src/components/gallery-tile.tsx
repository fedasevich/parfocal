import type { Decision } from "@parfocal/tokens";
import {
  aiWording,
  type TypeCall,
  type TyperEvidence,
  type WordingSetting,
} from "@parfocal/ui/lib/confidence-words";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type GalleryTileState = "to-check" | "current" | "done";

type GalleryTileSize = 40 | 92 | 120;

const dotColors: Record<Decision, string> = {
  agree: "bg-v-agree",
  disagree: "bg-v-disagree",
  unsure: "bg-v-unsure",
  open: "bg-chrome shadow-[0_0_0_2px_var(--chrome),inset_0_0_0_1.5px_var(--fg-faint)]",
};

const stateWords: Record<GalleryTileState, string> = {
  "to-check": "to check",
  current: "current",
  done: "done",
};

type GalleryTileAi = {
  calls: readonly TypeCall[];
  typer: TyperEvidence;
  wording: WordingSetting;
};

type GalleryTileProps = Omit<React.ComponentProps<"button">, "children"> & {
  image: string;
  objectId: string;
  label: string;
  size?: GalleryTileSize;
  state?: GalleryTileState;
  decision?: Decision;
  dimmed?: boolean;
  ringed?: boolean;
  imagePosition?: string | undefined;
  imageSize?: string | undefined;
  outline?: React.ReactNode;
  ai?: GalleryTileAi | undefined;
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
  ai,
  className,
  ...props
}: GalleryTileProps) {
  const crop = size === 40;
  const done = state === "done";
  const status = decision === "open" ? stateWords[state] : decision;
  const wording = ai ? aiWording(ai.calls, ai.wording, ai.typer) : undefined;
  const shown = wording?.text ?? label;
  return (
    <button
      type="button"
      data-slot="gallery-tile"
      data-state={state}
      data-size={size}
      data-decision={decision}
      aria-pressed={state === "current"}
      data-wording={wording?.mode ?? wording?.setting}
      data-band={wording?.band}
      aria-label={`${objectId} ${shown}, ${status}`}
      className={cn(
        "group/tile relative block shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0 text-left text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4 focus-visible:outline-solid",
        crop && "rounded-[5px]",
        dimmed && "opacity-45",
        className,
      )}
      style={crop ? undefined : { width: size }}
      {...props}
    >
      <span
        className={cn(
          "relative block overflow-hidden rounded-md bg-chrome-2 shadow-[inset_0_0_0_1px_var(--line)] group-hover/tile:shadow-[0_0_0_2px_var(--line-strong)]",
          crop && "rounded-[5px]",
          state === "current" && "shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_var(--accent)]",
          ringed &&
            "shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_color-mix(in_srgb,var(--accent)_75%,white)]",
        )}
      >
        <span
          data-slot="gallery-tile-image"
          className={cn(
            "relative block bg-[#111] bg-cover bg-center",
            done && !crop && "opacity-40",
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
                data-slot="gallery-tile-ring"
                className="absolute top-1/2 left-1/2 size-[42%] -translate-1/2 rounded-full border-[1.5px] border-dashed border-white/85"
              />
            ))}
          <span
            className={
              crop
                ? "sr-only"
                : "absolute bottom-1 left-1 rounded-[3px] bg-black/70 px-1 font-mono text-label leading-4 text-white"
            }
          >
            {objectId}
          </span>
        </span>{" "}
        <span
          data-slot="gallery-tile-label"
          className={
            crop ? "sr-only" : "block truncate px-1.25 py-0.75 text-label leading-3.5 text-fg-dim"
          }
        >
          {shown}
        </span>
      </span>
      <span
        aria-hidden="true"
        data-slot="gallery-tile-dot"
        className={cn(
          "absolute -right-0.75 -bottom-0.75 size-2.5 rounded-full shadow-[0_0_0_2px_var(--chrome)]",
          dotColors[decision],
          state === "to-check" && decision === "open" && !crop && "hidden",
        )}
      />
    </button>
  );
}

export {
  GalleryTile,
  type GalleryTileAi,
  type GalleryTileProps,
  type GalleryTileSize,
  type GalleryTileState,
};
