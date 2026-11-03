import { useState } from "react";

const storageKey = "parfocal.drafts";

type Drafts = Record<string, string>;

const slot = (owner: string, id: string) => `${owner}|${id}`;

function storage(): Storage | undefined {
  return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
}

function readAll(): Drafts {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(storageKey) ?? "{}");
    return parsed !== null && typeof parsed === "object" ? (parsed as Drafts) : {};
  } catch {
    return {};
  }
}

export function readDraft(owner: string, id: string): string | undefined {
  const text = readAll()[slot(owner, id)];
  return typeof text === "string" ? text : undefined;
}

export function keepDraft(owner: string, id: string, text: string): void {
  const drafts = readAll();
  if (text.trim()) drafts[slot(owner, id)] = text;
  else delete drafts[slot(owner, id)];
  try {
    if (Object.keys(drafts).length) storage()?.setItem(storageKey, JSON.stringify(drafts));
    else storage()?.removeItem(storageKey);
  } catch {
    return;
  }
}

export function useKeptDraft(
  owner: string | undefined,
  id: string,
  initial: string,
): [string, (text: string) => void] {
  const read = () => (owner === undefined ? undefined : readDraft(owner, id)) ?? initial;
  const [text, setText] = useState(read);
  const [readFor, setReadFor] = useState(owner);
  if (owner !== readFor) {
    setReadFor(owner);
    setText(read());
  }
  const change = (next: string) => {
    setText(next);
    if (owner !== undefined) keepDraft(owner, id, next);
  };
  return [text, change];
}
