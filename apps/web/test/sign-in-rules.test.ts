import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkPassword,
  clock,
  codeDigits,
  emailDomain,
  institutionFor,
  matchingInstitutions,
  safeReturnPath,
} from "../src/screens/onboarding/sign-in-rules.ts";

const institutions = [
  {
    workspace_id: "w1",
    name: "Fakultni nemocnice Vltava",
    short_name: "FN Vltava",
    logo: "FV",
    colour: "#0f766e",
    protocol: "SAML",
    domain: "fnvltava.example",
    matches_email: false,
  },
  {
    workspace_id: "w2",
    name: "Charles University AI Lab",
    short_name: "Charles University",
    logo: "CU",
    colour: "#7c3aed",
    protocol: "OpenID Connect",
    domain: "cuni.example",
    matches_email: false,
  },
];

test("a return path must stay on this site", () => {
  assert.equal(safeReturnPath("/projects/p1/slides/s1?task=t1"), "/projects/p1/slides/s1?task=t1");
  assert.equal(safeReturnPath("/my-work"), "/my-work");
  assert.equal(safeReturnPath("//evil.example"), null);
  assert.equal(safeReturnPath("https://evil.example"), null);
  assert.equal(safeReturnPath("/\\evil.example"), null);
  assert.equal(safeReturnPath("/a\nb"), null);
  assert.equal(safeReturnPath(undefined), null);
});

test("single sign-on matches on the email domain, ignoring case and spaces", () => {
  assert.equal(emailDomain("Lenka@FNVltava.example "), "fnvltava.example");
  assert.equal(institutionFor("lenka@fnvltava.example", institutions)?.workspace_id, "w1");
  assert.equal(institutionFor("someone@clinic.example", institutions), undefined);
  assert.equal(institutionFor("no-at-sign", institutions), undefined);
  assert.equal(institutionFor("x@", institutions), undefined);
});

test("the institution list filters by name or domain", () => {
  assert.equal(matchingInstitutions("", institutions).length, 2);
  assert.deepEqual(
    matchingInstitutions("cuni", institutions).map((item) => item.workspace_id),
    ["w2"],
  );
  assert.deepEqual(
    matchingInstitutions("vltava", institutions).map((item) => item.workspace_id),
    ["w1"],
  );
});

test("the code keeps six digits only and the clock reads minutes and seconds", () => {
  assert.equal(codeDigits("48 17-26x99"), "481726");
  assert.equal(clock(42), "0:42");
  assert.equal(clock(65), "1:05");
});

test("the password check reads length live and keeps reuse and leaks until the server says", () => {
  const empty = checkPassword("", []);
  assert.equal(empty.strength, 0);
  assert.deepEqual(
    empty.requirements.map((item) => item.met),
    [false, false, false],
  );
  const short = checkPassword("short", []);
  assert.equal(short.strength, 1);
  assert.equal(short.requirements[0]?.met, false);
  assert.equal(checkPassword("a-long-enough-pass", []).requirements[0]?.met, true);
  const reused = checkPassword("spring-meadow-2025", ["reused"]);
  assert.equal(reused.strength, 1);
  assert.deepEqual(
    reused.requirements.map((item) => item.met),
    [true, false, true],
  );
  assert.equal(checkPassword("a-very-long-passphrase-here", []).strength, 4);
});
