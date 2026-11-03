export type PrivacyChoice = "de-identified" | "clinical";

export type AnalysisChoice = "none" | "sentinel-node" | "cell-review";

export type ClassChip = { key: number; name: string; colour: string };

export type TaxonomyOption = { id: string; name: string; classes: ClassChip[] };

export type NewProjectValues = {
  name: string;
  privacy: PrivacyChoice;
  template: AnalysisChoice;
  taxonomy: string;
};

export type NewCaseValues = {
  label: string;
  specimen: string;
  patient: { name: string; birthNumber: string } | null;
};

export const privacyChoices: { id: PrivacyChoice; title: string; text: string }[] = [
  {
    id: "de-identified",
    title: "De-identified",
    text: "No patient fields. Names are stripped from files on upload.",
  },
  {
    id: "clinical",
    title: "Clinical",
    text: "Patient fields allowed and optional. Access is logged.",
  },
];

export const analysisChoices: { id: AnalysisChoice; title: string; text: string }[] = [
  {
    id: "sentinel-node",
    title: "Sentinel node staging",
    text: "Adds the staging card, the list of tumor areas and the measure step.",
  },
  {
    id: "cell-review",
    title: "Cell review",
    text: "Adds unsure zones and cell typing.",
  },
  {
    id: "none",
    title: "None",
    text: "Objects, layers, decisions and the opinion form only.",
  },
];

export const defaultTaxonomyFor = (template: AnalysisChoice): string =>
  template === "cell-review" ? "pannuke" : "sentinel-node";

export function projectProblem(values: NewProjectValues): string | null {
  return values.name.trim() === "" ? "Give the project a name." : null;
}

export function caseProblem(
  label: string,
  patient: { name: string; birthNumber: string },
  clinical: boolean,
): string | null {
  if (label.trim() === "") return "Give the case an ID.";
  if (clinical && patient.name.trim() === "" && patient.birthNumber.trim() !== "") {
    return "Add the patient's name, or clear the birth number.";
  }
  return null;
}

export function casePatient(
  patient: { name: string; birthNumber: string },
  clinical: boolean,
): NewCaseValues["patient"] {
  if (!clinical) return null;
  const name = patient.name.trim();
  if (name === "") return null;
  return { name, birthNumber: patient.birthNumber.trim() };
}
