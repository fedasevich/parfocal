import assert from "node:assert/strict";
import { test } from "node:test";
import type { PatientDetail } from "@parfocal/api-client";
import {
  ageOf,
  initialsOf,
  type PatientBannerInput,
  patientBanner,
} from "../src/viewer/patient-banner.ts";

const patient: PatientDetail = {
  id: "pt-1",
  name: "Testa Fake-Example",
  mrn: "000123",
  birth_date: "1960-07-15",
  sex: "female",
  age_years: null,
};

const today = new Date("2026-03-01T12:00:00Z");

const input = (over: Partial<PatientBannerInput> = {}): PatientBannerInput => ({
  clinical: true,
  patient,
  lab: { values: {}, locked: [] },
  personal: {},
  today,
  ...over,
});

test("a clinical case shows name, sex, age and record number by default", () => {
  assert.deepEqual(patientBanner(input()), {
    name: "Testa Fake-Example",
    initials: false,
    fields: [
      { label: "Sex", value: "Female" },
      { label: "Age", value: "65" },
      { label: "Record", value: "000123" },
    ],
  });
});

test("a research project never shows the banner, even with a patient", () => {
  assert.equal(patientBanner(input({ clinical: false })), null);
  assert.equal(patientBanner(input({ patient: null })), null);
});

test("the lab setting hides the banner and a personal value cannot bring it back", () => {
  const lab = { values: { patient_banner: false }, locked: [] };
  assert.equal(patientBanner(input({ lab })), null);
  assert.equal(patientBanner(input({ lab, personal: { patient_banner: true } })), null);
  assert.notEqual(patientBanner(input({ personal: { patient_banner: false } })), null);
});

test("initials mode shows only initials and keeps the other fields", () => {
  const banner = patientBanner(input({ personal: { patient_names: "initials" } }));
  assert.equal(banner?.name, "T. F. E.");
  assert.equal(banner?.initials, true);
  assert.equal(banner?.fields.length, 3);
});

test("a lab lock on initials wins over a personal choice of full names", () => {
  const lab = { values: { patient_names: "initials" }, locked: ["patient_names"] };
  const locked = patientBanner(input({ lab, personal: { patient_names: "full" } }));
  assert.equal(locked?.name, "T. F. E.");
  const unlocked = patientBanner(
    input({ lab: { ...lab, locked: [] }, personal: { patient_names: "full" } }),
  );
  assert.equal(unlocked?.name, "Testa Fake-Example");
});

test("initials ignore extra spaces and keep letters beyond ASCII", () => {
  assert.equal(initialsOf("  ana   élan "), "A. É.");
  assert.equal(initialsOf(""), "");
});

test("age prefers the stored years, then counts from the birth date", () => {
  assert.equal(ageOf({ ...patient, age_years: 40 }, today), 40);
  assert.equal(ageOf(patient, new Date("2026-07-15T00:00:00Z")), 66);
  assert.equal(ageOf({ ...patient, birth_date: null }, today), null);
  const banner = patientBanner(
    input({ patient: { ...patient, birth_date: null, mrn: null, sex: "unknown" } }),
  );
  assert.deepEqual(banner?.fields, [
    { label: "Sex", value: "Unknown" },
    { label: "Age", value: "Unknown" },
    { label: "Record", value: "None" },
  ]);
});
