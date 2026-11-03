import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import {
  caseDraft,
  failureText,
  nextCode,
  projectDraft,
  taxonomyOptions,
} from "../src/screens/project/new-forms-model.ts";

const projectId = "00000000-0000-4000-8003-000000000003";

test("the next project code is one past the highest number, padded", () => {
  assert.equal(nextCode([]), "P01");
  assert.equal(nextCode([{ number: 3 }, { number: 11 }, { number: 7 }]), "P12");
});

test("taxonomy templates become named options with their classes", () => {
  const options = taxonomyOptions([
    { template: "pannuke", classes: [{ key: 1, name: "Neoplastic", colour: "#d9534f" }] },
    { template: "sentinel-node", classes: [] },
  ]);
  assert.deepEqual(
    options.map((option) => [option.id, option.name, option.classes.length]),
    [
      ["pannuke", "PanNuke", 1],
      ["sentinel-node", "Sentinel node", 0],
    ],
  );
});

test("a project draft carries the privacy mode, template and class list", () => {
  assert.deepEqual(
    projectDraft({
      name: "Fake study",
      privacy: "clinical",
      template: "cell-review",
      taxonomy: "pannuke",
    }),
    { name: "Fake study", privacy_mode: "clinical", template: "cell-review", taxonomy: "pannuke" },
  );
});

test("a case draft in a de-identified project has no patient", () => {
  assert.deepEqual(
    caseDraft(projectId, { label: "S26-1", specimen: "Lymph node", patient: null }),
    {
      project_id: projectId,
      label: "S26-1",
      specimens: [{ letter: "A", type: "Lymph node" }],
    },
  );
});

test("a case draft in a clinical project carries the patient name and the number when given", () => {
  const withNumber = caseDraft(projectId, {
    label: "S26-2",
    specimen: "",
    patient: { name: "Fake Patient", birthNumber: "FAKE-0001" },
  });
  assert.deepEqual(withNumber.specimens, []);
  assert.deepEqual(withNumber.patient, { name: "Fake Patient", mrn: "FAKE-0001" });
  const nameOnly = caseDraft(projectId, {
    label: "S26-3",
    specimen: "",
    patient: { name: "Fake Patient", birthNumber: "" },
  });
  assert.deepEqual(nameOnly.patient, { name: "Fake Patient" });
});

test("a failure shows the server's title, or a network sentence", () => {
  assert.deepEqual(failureText(null), {});
  assert.deepEqual(failureText(new ApiError("conflict", 409, undefined)), {
    failure: "Request failed with conflict",
  });
  assert.deepEqual(failureText(new ApiError("network", 0)), {
    failure: "Could not reach the server. Try again.",
  });
});
