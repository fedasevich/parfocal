import { cn } from "@parfocal/ui/lib/utils";

type LoaderProposalProps = {
  label: string;
  still?: boolean;
  className?: string;
};

function frame({ label, className }: Pick<LoaderProposalProps, "label" | "className">) {
  return {
    role: "status" as const,
    "aria-label": label,
    className: cn("inline-flex size-full items-center justify-center text-accent-fill", className),
  };
}

function motion(still: boolean | undefined, name: string, slowerCount: number, ease: string) {
  if (still) return {};
  return {
    animationName: name,
    animationDuration: `calc(var(--motion-slower) * ${slowerCount})`,
    animationTimingFunction: ease,
    animationIterationCount: "infinite",
  };
}

function stagger(still: boolean | undefined, step: number) {
  return still ? {} : { animationDelay: `calc(var(--motion-fast) * ${step})` };
}

function ArcLoader({ still, ...rest }: LoaderProposalProps) {
  return (
    <span {...frame(rest)}>
      <svg viewBox="0 0 24 24" className="size-full" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="14 43"
          className="origin-center [transform-box:fill-box] motion-reduce:[animation:none]"
          style={motion(still, "pf-spin", 2, "linear")}
        />
      </svg>
    </span>
  );
}

function ScanLoader({ still, ...rest }: LoaderProposalProps) {
  return (
    <span {...frame(rest)}>
      <svg viewBox="0 0 32 24" className="size-full" fill="none" aria-hidden="true">
        <rect
          x="1"
          y="3"
          width="30"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <rect
          x="1.5"
          y="4"
          width="2"
          height="16"
          rx="1"
          fill="currentColor"
          className="motion-reduce:[animation:none]"
          style={{
            ...motion(still, "pf-sweep", 3, "ease-in-out"),
            opacity: still ? 0.8 : undefined,
            transform: still ? "translateX(13px)" : undefined,
          }}
        />
      </svg>
    </span>
  );
}

function ReticleLoader({ still, ...rest }: LoaderProposalProps) {
  return (
    <span {...frame(rest)}>
      <svg viewBox="0 0 24 24" className="size-full" fill="none" aria-hidden="true">
        <path
          d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="origin-center [transform-box:fill-box] motion-reduce:[animation:none]"
          style={motion(still, "pf-breathe", 4, "ease-in-out")}
        />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </svg>
    </span>
  );
}

const tileSteps = [0, 1, 2, 1, 2, 3, 2, 3, 4];

function TilesLoader({ still, ...rest }: LoaderProposalProps) {
  return (
    <span {...frame(rest)}>
      <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
        {tileSteps.map((step, index) => (
          <rect
            key={`${index}-${step}`}
            x={2 + (index % 3) * 7}
            y={2 + Math.floor(index / 3) * 7}
            width="6"
            height="6"
            rx="1"
            fill="currentColor"
            opacity={still ? 0.25 + step * 0.18 : undefined}
            className="motion-reduce:[animation:none]"
            style={{
              ...motion(still, "pf-wave", 3, "ease-in-out"),
              ...stagger(still, step),
            }}
          />
        ))}
      </svg>
    </span>
  );
}

const tickHeights = [0.5, 0.8, 1, 0.8, 0.5];

function TicksLoader({ still, ...rest }: LoaderProposalProps) {
  return (
    <span {...frame(rest)}>
      <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
        {tickHeights.map((height, index) => (
          <rect
            key={`${index}-${height}`}
            x={2 + index * 4.5}
            y={12 - height * 8}
            width="2.5"
            height={height * 16}
            rx="1.2"
            fill="currentColor"
            className="origin-center [transform-box:fill-box] motion-reduce:[animation:none]"
            style={{
              ...motion(still, "pf-tick", 2, "ease-in-out"),
              ...stagger(still, index),
            }}
          />
        ))}
      </svg>
    </span>
  );
}

const loaderProposals = [
  {
    id: "arc",
    name: "Arc",
    idea: "A short arc turning on a faint ring, the plainest and quietest option.",
    Loader: ArcLoader,
  },
  {
    id: "scan",
    name: "Scan",
    idea: "A bar sweeping across a slide outline, like the scanner that made the image.",
    Loader: ScanLoader,
  },
  {
    id: "reticle",
    name: "Reticle",
    idea: "Four focus corners breathing around a point, the parfocal idea of staying in focus.",
    Loader: ReticleLoader,
  },
  {
    id: "tiles",
    name: "Tiles",
    idea: "A grid of tiles fading in a diagonal wave, like a slide pyramid loading tile by tile.",
    Loader: TilesLoader,
  },
  {
    id: "ticks",
    name: "Ticks",
    idea: "Five bars rising and falling like the ticks of the magnification bar.",
    Loader: TicksLoader,
  },
] as const;

export type { LoaderProposalProps };
export { loaderProposals };
