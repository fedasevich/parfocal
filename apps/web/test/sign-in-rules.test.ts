import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkPassword,
  clock,
  codeDigits,
  emailDomain,
  organisationDomain,
  organisationSignInUrl,
  safeReturnPath,
} from "../src/screens/onboarding/sign-in-rules.ts";

test("the organisation sign-in takes a domain or a whole work email", () => {
  assert.equal(emailDomain("Lenka@FNVltava.example "), "fnvltava.example");
  assert.equal(emailDomain("no-at-sign"), "");
  assert.equal(organisationDomain(" FNVltava.example "), "fnvltava.example");
  assert.equal(organisationDomain("lenka@Hospital.example.org"), "hospital.example.org");
  assert.equal(organisationDomain("vltava"), null);
  assert.equal(organisationDomain("lenka@"), null);
  assert.equal(organisationDomain("bad domain.example"), null);
  assert.equal(organisationDomain("-bad.example"), null);
});

test("the organisation sign-in goes to the API with the domain and the return path", () => {
  assert.equal(
    organisationSignInUrl("hospital.example", "/projects?tab=open"),
    "/api/auth/sso?domain=hospital.example&return_to=%2Fprojects%3Ftab%3Dopen",
  );
  assert.equal(
    organisationSignInUrl("hospital.example", null),
    "/api/auth/sso?domain=hospital.example&return_to=%2F",
  );
});

test("a return path must stay on this site", () => {
  assert.equal(safeReturnPath("/projects/p1/slides/s1?task=t1"), "/projects/p1/slides/s1?task=t1");
  assert.equal(safeReturnPath("/my-work"), "/my-work");
  assert.equal(safeReturnPath("//evil.example"), null);
  assert.equal(safeReturnPath("https://evil.example"), null);
  assert.equal(safeReturnPath("/\\evil.example"), null);
  assert.equal(safeReturnPath("/a\nb"), null);
  assert.equal(safeReturnPath(undefined), null);
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
