import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ViewedRingProps = Omit<React.ComponentProps<"button">, "children"> & {
  percent: number;
  size?: number;
};

function ViewedRing({ percent, size = 36, className, ...props }: ViewedRingProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const stroke = Math.max(3, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <button
      type="button"
      data-slot="viewed-ring"
      data-percent={clamped}
      aria-label={`${clamped}% of the tissue seen at 10x or more. Open the whole slide`}
      title={`${clamped}% of the tissue seen at 10x or more. Click for the whole slide`}
      className={cn(
        "relative inline-grid shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-fg hover:bg-chrome-2",
        className,
      )}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--v-open)"
          strokeWidth={stroke}
        />
        <circle
          data-slot="viewed-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
        />
      </svg>
      <span className="relative text-label font-semibold tabular-nums">{clamped}</span>
    </button>
  );
}

export { ViewedRing, type ViewedRingProps };
