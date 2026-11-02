import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";

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

export function countsAsRule(
  decisionStyle: DecisionStyle,
  range: { agreeFrom: number; disagreeTo: number } = { agreeFrom: 4, disagreeTo: 2 },
) {
  return decisionStyle === "certainty"
    ? certaintyRule(range.agreeFrom, range.disagreeTo)
    : fixedRules[decisionStyle];
}
