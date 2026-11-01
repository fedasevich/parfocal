import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { NumberStepper } from "@parfocal/ui/components/number-stepper";
import { StackedBar } from "@parfocal/ui/components/progress-meter";
import { cn } from "cn";
import type * as React from "react";

const fixedRules: Record<Exclude<DecisionStyle, "certainty">, string> = {
  agree: "Each button counts as its name.",
  yesno:
    "Yes agrees when the AI claim is positive for the object, otherwise it disagrees, and No is the reverse.",
  blind: "The AI's class agrees, any other class disagrees.",
};

type CountsAsLineProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  decisionStyle: DecisionStyle;
  agreeFrom?: number;
  disagreeTo?: number;
  onRangeChange?: (range: { agreeFrom: number; disagreeTo: number }) => void;
  split?: { agree: number; unsure: number; disagree: number };
};

function CountsAsLine({
  decisionStyle,
  agreeFrom = 4,
  disagreeTo = 2,
  onRangeChange,
  split = { agree: 0, unsure: 0, disagree: 0 },
  className,
  ...props
}: CountsAsLineProps) {
  return (
    <div data-slot="counts-as" className={cn("grid gap-1.5", className)} {...props}>
      {decisionStyle === "certainty" ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body-sm leading-[1.45] text-fg">
          <span>Counts as agree from</span>
          <NumberStepper
            label="the first answer that agrees"
            value={agreeFrom}
            min={3}
            max={5}
            onValueChange={(value) =>
              onRangeChange?.({ agreeFrom: value ?? agreeFrom, disagreeTo })
            }
          />
          <span>and disagree up to</span>
          <NumberStepper
            label="the last answer that disagrees"
            value={disagreeTo}
            min={1}
            max={Math.min(3, agreeFrom - 1)}
            onValueChange={(value) =>
              onRangeChange?.({ agreeFrom, disagreeTo: value ?? disagreeTo })
            }
          />
          <span className="text-fg-dim">
            {agreeFrom - disagreeTo > 1
              ? `, ${Array.from({ length: agreeFrom - disagreeTo - 1 }, (_, index) => disagreeTo + index + 1).join(" and ")} count as not sure.`
              : ", nothing counts as not sure."}
          </span>
        </div>
      ) : (
        <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">
          Counts as: {fixedRules[decisionStyle]}
        </p>
      )}
      <StackedBar split={split} />
    </div>
  );
}

export { CountsAsLine, type CountsAsLineProps };
