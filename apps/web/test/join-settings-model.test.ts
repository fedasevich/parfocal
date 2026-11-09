import assert from "node:assert/strict";
import { test } from "node:test";
import type { JoinSettings } from "@parfocal/api-client";
import {
  canSave,
  changeOf,
  checkDomain,
  draftOf,
  logoOf,
  savedText,
} from "../src/screens/admin/join-settings-model.ts";

const saved: JoinSettings = {
  email_domain: "fnvltava.example",
  join_policy: "ask",
  logo: "FV",
  logo_colour: "#0f766e",
};

test("a lab domain passes and public or broken domains are refused", () => {
  assert.equal(checkDomain(""), "none");
  assert.equal(checkDomain(" @Lab.Uni-X.example "), "ok");
  assert.equal(checkDomain("gmail.com"), "public");
  assert.equal(checkDomain("Seznam.cz"), "public");
  assert.equal(checkDomain("outlook.de"), "public");
  assert.equal(checkDomain("lab"), "invalid");
  assert.equal(checkDomain("lab..cz"), "invalid");
  assert.equal(checkDomain("not a domain"), "invalid");
});

test("the change trims the domain, clears an empty one and keeps the logo letters", () => {
  const draft = { ...draftOf(saved), domain: " @Path.Example ", logo: "px1" };
  assert.deepEqual(changeOf(draft), {
    email_domain: "path.example",
    join_policy: "ask",
    logo: "PX1",
    logo_colour: "#0f766e",
  });
  assert.equal(changeOf({ ...draft, domain: "  " }).email_domain, null);
  assert.equal(changeOf({ ...draft, logo: "" }).logo, null);
  assert.equal(logoOf("a-b c d"), "ABC");
});

test("save waits for a real change and a domain that is allowed", () => {
  const draft = draftOf(saved);
  assert.equal(canSave(draft, saved), false);
  assert.equal(canSave({ ...draft, policy: "join" }, saved), true);
  assert.equal(canSave({ ...draft, domain: "gmail.com" }, saved), false);
  assert.equal(canSave({ ...draft, domain: "" }, saved), true);
  assert.equal(canSave({ ...draft, colour: "#2f6fdf" }, saved), true);
  assert.equal(canSave({ ...draft, logo: "" }, saved), false);
});

test("the saved message says who can join", () => {
  const draft = draftOf(saved);
  assert.equal(
    savedText(changeOf({ ...draft, policy: "join" })),
    "People with an @fnvltava.example email can join at once.",
  );
  assert.equal(
    savedText(changeOf({ ...draft, domain: "" })),
    "No email domain is set, so no one can find the workspace.",
  );
});
