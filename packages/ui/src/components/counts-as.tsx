import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { NumberStepper } from "@parfocal/ui/components/number-stepper";
import { StackedBar } from "@parfocal/ui/components/progress-meter";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const fixedRules: Record<Exclude<DecisionStyle, "certainty">, string> = {
  agree: "Each answer counts as it reads. Not sure stays not sure.",
  yesno:
    "An answer that matches the AI's claim counts as agree, the other as disagree. Not sure stays not sure.",
  blind:
    "The same class as the AI's counts as agree, another class as disagree. Not sure stays not sure.",
};

const span = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

const numberList = (values: number[]) =>
  values.length === 1
    ? `${values[0]}`
    : values.length === 2
      ? `${values[0]} and ${values[1]}`
      : `${values[0]} to ${values[values.length - 1]}`;

function certaintyRule(agreeFrom: number, disagreeTo: number) {
  const agree = span(agreeFrom, 5);
  const unsure = span(disagreeTo + 1, agreeFrom - 1);
  const disagree = span(1, disagreeTo);
  const middle = unsure.length ? `${numberList(unsure)} as not sure, and ` : "and ";
  return `${numberList(agree)} count${agree.length === 1 ? "s" : ""} as agree with the AI, ${middle}${numberList(disagree)} as disagree.${unsure.length ? "" : " No answer counts as not sure."}`;
}

function countsAsRule(
  decisionStyle: DecisionStyle,
  range: { agreeFrom: number; disagreeTo: number } = { agreeFrom: 4, disagreeTo: 2 },
) {
  return decisionStyle === "certainty"
    ? certaintyRule(range.agreeFrom, range.disagreeTo)
    : fixedRules[decisionStyle];
}

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

export { CountsAsLine, type CountsAsLineProps, countsAsRule };
