import type { VerdictReason } from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";

export type ReasonOption = {
  code: VerdictReason;
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
): { reasons: VerdictReason[]; reason_class_id: string | null } {
  const picked = labels.flatMap((label) => options.filter((option) => option.label === label));
  const reasons = [...new Set(picked.map((option) => option.code))];
  const withClass = picked.find((option) => option.classId !== null);
  return { reasons, reason_class_id: withClass?.classId ?? null };
}
