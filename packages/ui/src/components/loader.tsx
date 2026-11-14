import { cn } from "@parfocal/ui/lib/utils";

type LoaderSize = "inline" | "block" | "page";

type LoaderProps = {
  label: string;
  size?: LoaderSize;
  still?: boolean;
  className?: string;
};

const glyphSize: Record<LoaderSize, string> = {
  inline: "size-4",
  block: "size-12",
  page: "size-16",
};

function Reticle({ size, still }: { size: LoaderSize; still: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("shrink-0 text-accent-fill", glyphSize[size])}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="origin-center [transform-box:fill-box] motion-reduce:[animation:none]"
        style={
          still
            ? undefined
            : {
                animationName: "pf-breathe",
                animationDuration: "calc(var(--motion-slower) * 4)",
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
              }
        }
      />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

function Loader({ label, size = "block", still = false, className }: LoaderProps) {
  const body = (
    <span
      role="status"
      className={cn(
        "inline-flex items-center justify-center",
        size === "inline" ? "align-middle" : "w-full",
        className,
      )}
    >
      <Reticle size={size} still={still} />
      <span className="sr-only">{label}</span>
    </span>
  );
  if (size === "page") {
    return <main className="grid h-dvh place-items-center bg-page">{body}</main>;
  }
  return body;
}

export type { LoaderProps, LoaderSize };
export { Loader };
