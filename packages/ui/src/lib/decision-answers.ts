export type DecisionStyle = "certainty" | "agree" | "yesno" | "blind";

export type CountsAs = "agree" | "disagree" | "unsure";

export type DecisionAnswer = {
  raw: string;
  label: string;
  key: string;
  action?: string | undefined;
  countsAs?: CountsAs | undefined;
  color?: string | undefined;
};

export type ProjectClass = { name: string; color: string; id?: string | undefined };

const certaintyLabels = ["Certainly not", "Probably not", "Can't tell", "Probably", "Certainly"];

export function answersFor(
  style: DecisionStyle,
  classes: ProjectClass[] = [],
  aiClass?: string,
  range: { agreeFrom: number; disagreeTo: number } = { agreeFrom: 4, disagreeTo: 2 },
): DecisionAnswer[] {
  const notSure: DecisionAnswer = {
    raw: "unsure",
    label: "Not sure",
    key: "U",
    action: "dunsure",
    countsAs: "unsure",
  };
  if (style === "certainty") {
    return certaintyLabels.map((label, index) => {
      const value = index + 1;
      const countsAs: CountsAs =
        value >= range.agreeFrom ? "agree" : value <= range.disagreeTo ? "disagree" : "unsure";
      return { raw: String(value), label, key: String(value), action: `dcert:${value}`, countsAs };
    });
  }
  if (style === "agree") {
    return [
      { raw: "agree", label: "Agree", key: "K", action: "dagree", countsAs: "agree" },
      { raw: "disagree", label: "Disagree", key: "X", action: "ddisagree", countsAs: "disagree" },
      notSure,
    ];
  }
  if (style === "yesno") {
    return [
      { raw: "yes", label: "Yes", key: "Y", action: "dyes" },
      { raw: "no", label: "No", key: "N", action: "dno" },
      notSure,
    ];
  }
  return [
    ...classes.map((projectClass, index) => ({
      raw: projectClass.name,
      label: projectClass.name,
      key: String(index + 1),
      action: `dclass:${index + 1}`,
      color: projectClass.color,
      countsAs:
        aiClass === undefined
          ? undefined
          : projectClass.name === aiClass
            ? ("agree" as const)
            : ("disagree" as const),
    })),
    notSure,
  ];
}
