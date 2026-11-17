import assert from "node:assert/strict";
import { test } from "node:test";
import { storageSize } from "../src/screens/admin/storage-size.ts";
import { greetingName } from "../src/screens/format.ts";

test("the greeting uses the first word of a real display name", () => {
  assert.equal(
    greetingName({ display_name: "Lenka Marková", email: "lenka@example.test" }),
    "Lenka",
  );
  assert.equal(greetingName({ display_name: "  Dana  ", email: null }), "Dana");
});

test("a placeholder display name falls back to the email's local part", () => {
  assert.equal(
    greetingName({ display_name: "Workspace owner", email: "yurii.f@example.test" }),
    "Yurii",
  );
  assert.equal(greetingName({ display_name: "New user", email: "anna@example.test" }), "Anna");
  assert.equal(greetingName({ display_name: "", email: "petr_n@example.test" }), "Petr");
  assert.equal(greetingName({ display_name: "jana@example.test", email: null }), "Jana");
});

test("with no name and no email the greeting stays friendly", () => {
  assert.equal(greetingName({ display_name: "Workspace owner", email: null }), "there");
});

test("storage shows in the largest unit that keeps a non-zero number", () => {
  assert.equal(storageSize(0.0022), "2.2 GB");
  assert.equal(storageSize(2.25), "2.3 TB");
  assert.equal(storageSize(0.4), "0.4 TB");
  assert.equal(storageSize(0.04), "40 GB");
  assert.equal(storageSize(0.0000031), "3.1 MB");
  assert.equal(storageSize(0), "0 TB");
});
