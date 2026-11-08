import type { StoredSettingValues } from "@parfocal/api-client";

export type PatientBannerLab = {
  readonly values: StoredSettingValues;
  readonly locked: readonly string[];
};

export function lockAfterText(minutes: number | undefined): string {
  return minutes === undefined ? "" : `${minutes} min`;
}

export function patientBannerText(lab: PatientBannerLab | undefined): string {
  const names = lab?.values.patient_names === "initials" ? "initials only" : "full name";
  return lab?.values.patient_banner === false ? "Hidden" : `Shown with ${names}`;
}
