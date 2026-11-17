import { cn } from "@parfocal/ui/lib/utils";

type TopProgressProps = {
  active: boolean;
  label: string;
  className?: string;
};

function TopProgress({ active, label, className }: TopProgressProps) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      data-slot="top-progress"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-accent-fill/15",
        className,
      )}
      style={{
        animationName: "pf-fade-in",
        animationDuration: "var(--motion-slow)",
        animationDelay: "var(--motion-fast)",
        animationFillMode: "both",
      }}
    >
      <div
        className="h-full w-2/5 rounded-full bg-accent-fill motion-reduce:w-full motion-reduce:opacity-60 motion-reduce:[animation:none]"
        style={{
          animationName: "pf-progress-sweep",
          animationDuration: "calc(var(--motion-slower) * 3.5)",
          animationTimingFunction: "ease-in-out",
          animationIterationCount: "infinite",
        }}
      />
    </div>
  );
}

export type { TopProgressProps };
export { TopProgress };
