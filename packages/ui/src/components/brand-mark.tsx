import { cn } from "@parfocal/ui/lib/utils";

type BrandMarkProps = {
  className?: string;
  breathing?: boolean;
};

function BrandMark({ className, breathing = false }: BrandMarkProps) {
  return (
    <svg
      data-slot="brand-mark"
      viewBox="0 0 32 32"
      className={cn("size-6 shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" className="fill-accent-fill" />
      <g
        transform="translate(4 4)"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-on-accent"
      >
        <path
          d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"
          className="origin-center [transform-box:fill-box] motion-reduce:[animation:none]"
          style={
            breathing
              ? {
                  animationName: "pf-breathe",
                  animationDuration: "calc(var(--motion-slower) * 4)",
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }
              : undefined
          }
        />
      </g>
      <circle cx="16" cy="16" r="2.4" className="fill-on-accent" />
    </svg>
  );
}

export type { BrandMarkProps };
export { BrandMark };
