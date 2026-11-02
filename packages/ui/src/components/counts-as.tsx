import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { NumberStepper } from "@parfocal/ui/components/number-stepper";
import { StackedBar } from "@parfocal/ui/components/progress-meter";
import { countsAsRule } from "@parfocal/ui/lib/counts-as-rule";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type CountsAsLineProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  decisionStyle: DecisionStyle;
  agreeFrom?: number;
  disagreeTo?: number;
  onRangeChange?: (range: { agreeFrom: number; disagreeTo: number }) => void;
  split?: { agree: number; unsure: number; disagree: number };
  emptyText?: string;
};

function CountsAsLine({
  decisionStyle,
  agreeFrom = 4,
  disagreeTo = 2,
  onRangeChange,
  split = { agree: 0, unsure: 0, disagree: 0 },
  emptyText = "No answers yet. The split fills in as reviews come in.",
  className,
  ...props
}: CountsAsLineProps) {
  return (
    <div data-slot="counts-as" className={cn("grid gap-1.5", className)} {...props}>
      {decisionStyle === "certainty" ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body-sm leading-[1.45] text-fg">
          <span>Counts as agree from</span>
          <NumberStepper
            label="Agree starts at"
            value={agreeFrom}
            min={Math.max(3, disagreeTo + 1)}
            max={5}
            onValueChange={(value) =>
              onRangeChange?.({ agreeFrom: value ?? agreeFrom, disagreeTo })
            }
          />
          <span>up, and as disagree from</span>
          <NumberStepper
            label="Disagree ends at"
            value={disagreeTo}
            min={1}
            max={Math.min(3, agreeFrom - 1)}
            onValueChange={(value) =>
              onRangeChange?.({ agreeFrom, disagreeTo: value ?? disagreeTo })
            }
          />
          <span>down.</span>
        </div>
      ) : null}
      <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">
        {countsAsRule(decisionStyle, { agreeFrom, disagreeTo })}
      </p>
      <StackedBar split={split} emptyText={emptyText} className="mt-1" />
    </div>
  );
}

export { CountsAsLine, type CountsAsLineProps };
