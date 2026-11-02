type DecisionSplit = { agree: number; disagree: number; unsure: number; open: number };

type Decision = keyof DecisionSplit;

const decisionOrder: readonly Decision[] = ["agree", "disagree", "unsure", "open"];

type RingArc = { decision: Decision; length: number; offset: number };

function splitTotal(split: DecisionSplit): number {
  return decisionOrder.reduce((sum, key) => sum + split[key], 0);
}

function donePercent(split: DecisionSplit): number {
  const total = splitTotal(split);
  return total === 0 ? 0 : Math.round(((total - split.open) / total) * 100);
}

function ringArcs(split: DecisionSplit, circumference: number): RingArc[] {
  const total = splitTotal(split);
  if (total === 0) return [];
  let offset = 0;
  return decisionOrder
    .filter((decision) => split[decision] > 0)
    .map((decision) => {
      const length = (split[decision] / total) * circumference;
      const arc = { decision, length, offset };
      offset += length;
      return arc;
    });
}

type StackedDecision = "agree" | "unsure" | "disagree";

const stackedOrder: readonly StackedDecision[] = ["agree", "unsure", "disagree"];

type StackedPart = { decision: StackedDecision; count: number; share: number };

function stackedParts(split: Omit<DecisionSplit, "open">): StackedPart[] {
  const total = split.agree + split.unsure + split.disagree;
  return stackedOrder.map((decision) => ({
    decision,
    count: split[decision],
    share: total === 0 ? 0 : split[decision] / total,
  }));
}

export {
  type Decision,
  type DecisionSplit,
  decisionOrder,
  donePercent,
  type RingArc,
  ringArcs,
  type StackedDecision,
  type StackedPart,
  splitTotal,
  stackedParts,
};
