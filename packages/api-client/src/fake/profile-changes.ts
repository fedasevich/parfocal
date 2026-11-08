import { HttpResponse, http, type RequestHandler } from "msw";
import type { Me, ProfileChange } from "../generated/api.ts";

const storageKey = "parfocal.fake.profile";
const longestName = 200;

type Stored = Record<string, ProfileChange>;

let memory: Stored = {};

function device(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function stored(): Stored {
  try {
    const kept = device()?.getItem(storageKey);
    return kept === null || kept === undefined ? memory : (JSON.parse(kept) as Stored);
  } catch {
    return memory;
  }
}

function keep(next: Stored): void {
  memory = next;
  try {
    device()?.setItem(storageKey, JSON.stringify(next));
  } catch {
    return;
  }
}

export function withProfileChanges(me: Me): Me {
  const change = stored()[me.user_id] ?? {};
  return {
    ...me,
    display_name: change.display_name ?? me.display_name,
    initials: change.initials ?? me.initials,
    avatar_colour: change.avatar_colour ?? me.avatar_colour,
    title: change.title === undefined ? me.title : change.title || null,
  };
}

export function resetFakeProfile(): void {
  memory = {};
  try {
    device()?.removeItem(storageKey);
  } catch {
    return;
  }
}

const refused = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "The name must be 1 to 200 characters",
      status: 422,
      errors: [{ location: ["body", "display_name"], message: "Invalid name" }],
    },
    { status: 422, headers: { "content-type": "application/problem+json" } },
  );

export function profileChangeHandler(currentMe: () => Me): RequestHandler {
  return http.patch("*/api/me", async ({ request }) => {
    const change = (await request.json()) as ProfileChange;
    const name = change.display_name?.trim();
    if (name !== undefined && (name === "" || name.length > longestName)) return refused();
    const me = currentMe();
    const all = stored();
    const cleaned = name === undefined ? change : { ...change, display_name: name };
    keep({ ...all, [me.user_id]: { ...all[me.user_id], ...cleaned } });
    return HttpResponse.json(withProfileChanges(me));
  });
}
