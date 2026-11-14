import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  hasPlainLetters,
  localeFor,
  pseudoLocaleKey,
  pseudoRequested,
} from "../src/i18n/locale.ts";

const catalogue = (locale: string) =>
  readFileSync(new URL(`../src/locales/${locale}.po`, import.meta.url), "utf8");

test("the locale follows the language setting and falls back to English", () => {
  assert.equal(localeFor(undefined, false), "en");
  assert.equal(localeFor("en", false), "en");
  assert.equal(localeFor("cs", false), "cs");
});

test("the pseudo locale wins over the language setting when it is asked for", () => {
  assert.equal(localeFor("cs", true), "en-XA");
  assert.equal(localeFor(undefined, true), "en-XA");
});

test("the pseudo locale is asked for through one storage key", () => {
  const stored = (value: string | null) => ({
    getItem: (key: string) => (key === pseudoLocaleKey ? value : null),
  });
  assert.equal(pseudoRequested(stored("1")), true);
  assert.equal(pseudoRequested(stored(null)), false);
  assert.equal(pseudoRequested(undefined), false);
  assert.equal(
    pseudoRequested({
      getItem: () => {
        throw new Error("storage is blocked");
      },
    }),
    false,
  );
});

test("plain letters are found in English and not in pseudo text", () => {
  assert.equal(hasPlainLetters("Page not found"), true);
  assert.equal(hasPlainLetters("Ƥàĝē ńōţ ƒōũńď"), false);
  assert.equal(hasPlainLetters("Ēvēŕŷţĥĩńĝ ŷōũ śàvēď ĩś ķēƥţ"), false);
  assert.equal(hasPlainLetters("Ƥàĝē not ƒōũńď"), true);
  assert.equal(hasPlainLetters("Ŷōũŕ śēśśĩōń ēńďēď àƒţēŕ {hours} ĥōũŕś. 11:02"), false);
  assert.equal(hasPlainLetters("<0>Ĉōńńēćţĩōń ĺōśţ.</0> 8"), false);
});

test("the English catalogue holds the extracted messages of the converted screens", () => {
  const english = catalogue("en");
  assert.match(english, /msgid "Page not found"/);
  assert.match(english, /msgid "\{what\} is not available yet\./);
  assert.doesNotMatch(english, /^#: .+:\d+$/m);
});

test("every locale catalogue lists the same messages as English", () => {
  const ids = (text: string) => [...text.matchAll(/^msgid "(.+)"$/gm)].map((found) => found[1]);
  const english = ids(catalogue("en"));
  assert.ok(english.length > 0);
  assert.deepEqual(ids(catalogue("cs")), english);
  assert.deepEqual(ids(catalogue("en-XA")), english);
});
