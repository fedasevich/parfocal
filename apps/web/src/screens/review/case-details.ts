import type { SpecimenDetail } from "@parfocal/api-client";
import type { CaseDetailsData } from "@parfocal/ui/components/review-popovers";

type Source = {
  projectName?: string | undefined;
  clinical: boolean;
  caseLabel?: string | undefined;
  specimens?:
    | Pick<SpecimenDetail, "letter" | "type" | "site" | "laterality" | "blocks">[]
    | undefined;
  taskTitle?: string | undefined;
  researcher?: string | undefined;
  clinicalNote?: string | undefined;
};

const sides = new Set(["left", "right", "bilateral"]);

export function specimenText(
  specimen: Pick<SpecimenDetail, "letter" | "type" | "site" | "laterality">,
): string {
  const words = [
    specimen.type,
    specimen.site,
    sides.has(specimen.laterality) ? specimen.laterality : null,
  ]
    .filter((word): word is string => Boolean(word?.trim()))
    .join(", ");
  return words ? `${specimen.letter} · ${words}` : specimen.letter;
}

export function caseDetailsOf(source: Source): CaseDetailsData {
  const specimens = source.specimens ?? [];
  const described = specimens.filter((specimen) => specimenText(specimen) !== specimen.letter);
  const blocks = specimens.flatMap((specimen) =>
    [...specimen.blocks]
      .sort((left, right) => left.number - right.number)
      .map((block) => `${specimen.letter}${block.number}`),
  );
  return {
    project: source.projectName,
    caseLabel: source.caseLabel,
    specimen: described.length > 0 ? described.map(specimenText).join("; ") : undefined,
    blocks,
    task: source.taskTitle,
    researcher: source.researcher,
    clinical: source.clinical,
    clinicalNote: source.clinicalNote,
  };
}
