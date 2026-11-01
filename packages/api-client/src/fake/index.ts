import { faker } from "@faker-js/faker";
import type { RequestHandler } from "msw";
import { getParfocalAPIMock } from "../generated/api.msw.ts";

export const fakeDataSeed = 4812;

export function fakeApiHandlers(): RequestHandler[] {
  faker.seed(fakeDataSeed);
  return getParfocalAPIMock();
}
