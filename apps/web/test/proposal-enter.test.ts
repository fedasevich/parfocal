import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enterAcceptsProposals } from "../src/viewer/proposal-enter.ts";

type Node = {
  readonly tag: string;
  readonly attrs: readonly string[];
  readonly parent: Node | null;
};

const matchesOne = (node: Node, selector: string) =>
  selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      if (part.startsWith("[")) return node.attrs.includes(part.slice(1, -1).split("=")[0] ?? "");
      const [tag, attr] = part.split("[");
      return node.tag === tag && (attr === undefined || node.attrs.includes(attr.slice(0, -1)));
    });

const element = (node: Node) => {
  const wrap = (current: Node) => ({
    matches: (selector: string) => matchesOne(current, selector),
  });
  return {
    closest(selector: string) {
      for (let current: Node | null = node; current !== null; current = current.parent) {
        if (matchesOne(current, selector)) return wrap(current);
      }
      return null;
    },
  };
};

const stage: Node = { tag: "div", attrs: ["data-tool"], parent: null };

describe("Enter accepts a proposal", () => {
  it("accepts from the page and from a pressed tool button", () => {
    assert.equal(enterAcceptsProposals(null), true);
    assert.equal(enterAcceptsProposals(element(stage)), true);
    const rail: Node = { tag: "button", attrs: ["data-tool", "aria-pressed"], parent: null };
    assert.equal(enterAcceptsProposals(element(rail)), true);
    const best: Node = { tag: "button", attrs: ["aria-pressed"], parent: stage };
    assert.equal(enterAcceptsProposals(element(best)), true);
  });

  it("leaves Enter to text fields and to other buttons, even inside the stage", () => {
    const field: Node = { tag: "input", attrs: [], parent: stage };
    assert.equal(enterAcceptsProposals(element(field)), false);
    const discard: Node = { tag: "button", attrs: [], parent: stage };
    assert.equal(enterAcceptsProposals(element(discard)), false);
  });
});
