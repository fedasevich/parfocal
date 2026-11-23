import { HttpResponse, http, type RequestHandler } from "msw";
import type { TourSwitch } from "../generated/api.ts";
import { type PersonKey, people, signedInAs } from "./scenario.ts";

const storageKey = "parfocal.fake.tour-persona";

const personaOf: Record<TourSwitch["account"], PersonKey> = {
  researcher: "DH",
  "reviewer-a": "LM",
  "reviewer-b": "TB",
  adjudicator: "AK",
  viewer: "JR",
  annotator: "SM",
};

const isPersona = (value: string | null): value is PersonKey =>
  value !== null && Object.hasOwn(people, value);

export function storedTourPersona(): PersonKey | null {
  const stored = window.sessionStorage.getItem(storageKey);
  return isPersona(stored) ? stored : null;
}

const shown = (key: PersonKey, switched: boolean) => ({
  name: people[key].name,
  email: `${key.toLowerCase()}@fake.parfocal.eu`,
  switched,
});

export function tourSwitchHandlers(): RequestHandler[] {
  return [
    http.post("*/api/tour/role-switch", async ({ request }) => {
      const body = (await request.json()) as Partial<TourSwitch>;
      const persona = body.account === undefined ? undefined : personaOf[body.account];
      if (persona === undefined) {
        return HttpResponse.json(
          {
            title: "This workspace has no such role account",
            status: 404,
            code: "no-role-account",
          },
          { status: 404, headers: { "content-type": "application/problem+json" } },
        );
      }
      window.sessionStorage.setItem(storageKey, persona);
      return HttpResponse.json(shown(persona, true));
    }),
    http.delete("*/api/tour/role-switch", () => {
      window.sessionStorage.removeItem(storageKey);
      return HttpResponse.json(shown(signedInAs, false));
    }),
  ];
}
