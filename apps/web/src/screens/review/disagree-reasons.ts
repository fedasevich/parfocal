import type { DecisionReason } from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";

export type ReasonOption = {
  code: DecisionReason;
  label: string;
  classId: string | null;
};

type Kind = "region" | "cell";

export const classPhrase = (name: string) =>
  name.toLowerCase() === "immune" ? "an immune cell" : name.toLowerCase();

export function otherClasses(classes: ProjectClass[], aiClass: string): ProjectClass[] {
  return classes
    .filter((item) => item.name !== aiClass && item.name !== "Other")
    .reverse()
    .slice(0, 2);
}

export function disagreeOptions(
  kind: Kind,
  aiClass: string,
  classes: ProjectClass[],
): ReasonOption[] {
  if (kind === "region") {
    return [
      { code: "not_class", label: `Not ${aiClass.toLowerCase()}`, classId: null },
      { code: "boundary_off", label: "Boundary is off", classId: null },
      { code: "two_regions", label: "Two regions, not one", classId: null },
      { code: "artefact", label: "Artefact or fold", classId: null },
    ];
  }
  return [
    { code: "not_a_cell", label: "Not a cell", classId: null },
    ...otherClasses(classes, aiClass).map((item) => ({
      code: "wrong_class" as const,
      label: `It is ${classPhrase(item.name)}`,
      classId: item.id ?? null,
    })),
    { code: "artefact", label: "Artefact", classId: null },
  ];
}

export function reasonDraft(
  labels: string[],
  options: ReasonOption[],
): { reasons: DecisionReason[]; reason_class_id: string | null } {
  const picked = labels.flatMap((label) => options.filter((option) => option.label === label));
  const reasons = [...new Set(picked.map((option) => option.code))];
  const withClass = picked.find((option) => option.classId !== null);
  return { reasons, reason_class_id: withClass?.classId ?? null };
}

const isType = (option: ReasonOption) => option.code === "wrong_class";

const deniesType = (option: ReasonOption) =>
  option.code === "not_a_cell" || option.code === "artefact";

const contradicts = (first: ReasonOption, second: ReasonOption) =>
  first !== second &&
  ((isType(first) && (isType(second) || deniesType(second))) ||
    (isType(second) && deniesType(first)));

export function toggleReasonLabel(
  labels: string[],
  label: string,
  options: ReasonOption[],
): string[] {
  if (labels.includes(label)) return labels.filter((item) => item !== label);
  const picked = options.find((option) => option.label === label);
  if (picked === undefined) return [...labels, label];
  const clashing = new Set(
    options.filter((option) => contradicts(picked, option)).map((option) => option.label),
  );
  return [...labels.filter((item) => !clashing.has(item)), label];
}

export function savedReasonLabels(
  codes: DecisionReason[],
  classId: string | null,
  options: ReasonOption[],
  fallback: (code: DecisionReason) => string,
): string[] {
  return codes.map((code) => {
    const matching = options.filter((option) => option.code === code);
    const exact = matching.find((option) => option.classId === classId);
    const plain = matching.find((option) => option.classId === null);
    return (exact ?? plain)?.label ?? fallback(code);
  });
}
