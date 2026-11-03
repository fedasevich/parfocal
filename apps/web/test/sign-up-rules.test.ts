import assert from "node:assert/strict";
import { test } from "node:test";
import {
  looksLikeEmail,
  signUpProblem,
  strengthLine,
} from "../src/screens/onboarding/sign-up-rules.ts";

const complete = {
  name: "Jana Nováková",
  email: "jana@clinic.example",
  password: "twelve-chars!",
  acceptedTerms: true,
};

test("complete details have no problem", () => {
  assert.equal(signUpProblem(complete), null);
});

test("the first missing detail is named, in the order of the form", () => {
  assert.match(signUpProblem({ ...complete, name: " " }) ?? "", /name/);
  assert.match(signUpProblem({ ...complete, email: "jana" }) ?? "", /email/);
  assert.match(signUpProblem({ ...complete, password: "short" }) ?? "", /12 characters/);
  assert.match(signUpProblem({ ...complete, acceptedTerms: false }) ?? "", /terms/);
  assert.match(signUpProblem({ ...complete, name: "", acceptedTerms: false }) ?? "", /name/);
});

test("an email needs an at sign and a dotted domain", () => {
  assert.equal(looksLikeEmail(" a@b.cz "), true);
  assert.equal(looksLikeEmail("a@b"), false);
  assert.equal(looksLikeEmail("a b@c.cz"), false);
});

test("the strength line counts characters and stays empty before typing", () => {
  assert.equal(strengthLine("Strong", ""), "");
  assert.equal(strengthLine("Strong", "abcdefghijklmnopqrst"), "Strong · 20 characters");
});
