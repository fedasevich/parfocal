import {
  type PatientDetail,
  resolveSetting,
  type SettingLayers,
  type StoredSettingValues,
} from "@parfocal/api-client";

export type PatientBannerField = { readonly label: string; readonly value: string };

export type PatientBanner = {
  readonly name: string;
  readonly initials: boolean;
  readonly fields: readonly PatientBannerField[];
};

export type PatientBannerInput = {
  readonly clinical: boolean;
  readonly patient: PatientDetail | null;
  readonly lab: { readonly values: StoredSettingValues; readonly locked: readonly string[] };
  readonly personal: StoredSettingValues;
  readonly today: Date;
};

const sexLabels: Record<PatientDetail["sex"], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  unknown: "Unknown",
};

export function initialsOf(name: string): string {
  return name
    .split(/[\s-]+/u)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}.`)
    .join(" ");
}

export function ageOf(patient: PatientDetail, today: Date): number | null {
  if (patient.age_years !== null) return patient.age_years;
  if (patient.birth_date === null) return null;
  const [year, month, day] = patient.birth_date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  if ([year, month, day].some((part) => !Number.isInteger(part))) return null;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  const age = today.getUTCFullYear() - year - (beforeBirthday ? 1 : 0);
  return age >= 0 ? age : null;
}

export function patientBanner(input: PatientBannerInput): PatientBanner | null {
  if (!input.clinical || input.patient === null) return null;
  const layers: SettingLayers = {
    lab: { values: input.lab.values, locked: input.lab.locked },
    personal: input.personal,
    device: {},
  };
  if (!resolveSetting("patient_banner", layers).value) return null;
  const initials = resolveSetting("patient_names", layers).value === "initials";
  const patient = input.patient;
  const age = ageOf(patient, input.today);
  return {
    name: initials ? initialsOf(patient.name) : patient.name,
    initials,
    fields: [
      { label: "Sex", value: sexLabels[patient.sex] },
      { label: "Age", value: age === null ? "Unknown" : `${age}` },
      { label: "Record", value: patient.mrn ?? "None" },
    ],
  };
}
