import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabSettings, SecuritySetting } from "@parfocal/api-client";
import {
  signInRows,
  twoFactorChange,
  twoFactorRequired,
} from "../src/screens/admin/security-model.ts";

const lab: LabSettings = { values: { two_factor_required: true }, locked: ["patient_banner"] };

const listed: SecuritySetting[] = [
  { key: "sso", label: "Lab single sign-on", detail: "SAML", on: true, locked: false },
  { key: "password", label: "Email and password", detail: "", on: true, locked: false },
];

test("two factors are off until the workspace saves them on", () => {
  assert.equal(twoFactorRequired(undefined), false);
  assert.equal(twoFactorRequired({ values: {}, locked: [] }), false);
  assert.equal(twoFactorRequired(lab), true);
});

test("single sign-on is shown locked because it is set up with the identity provider", () => {
  const rows = signInRows(listed, lab);
  assert.deepEqual(
    rows.map((row) => [row.key, row.locked]),
    [
      ["sso", true],
      ["password", false],
      ["two_factor_required", false],
    ],
  );
  assert.equal(rows.at(-1)?.on, true);
});

test("without a listed method the real workspace still shows single sign-on and two factors", () => {
  const rows = signInRows(undefined, { values: {}, locked: [] });
  assert.deepEqual(
    rows.map((row) => [row.key, row.on, row.locked]),
    [
      ["sso", false, true],
      ["two_factor_required", false, false],
    ],
  );
});

test("saving two factors keeps the locks the workspace already has", () => {
  assert.deepEqual(twoFactorChange(lab, false), {
    values: { two_factor_required: false },
    locked: ["patient_banner"],
  });
});
