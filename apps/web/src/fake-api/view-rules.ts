import { defaultFakeView, type FakeView, scenario } from "@parfocal/api-client/fake";

const isPersona = (value: unknown): value is keyof typeof scenario.people =>
  typeof value === "string" && Object.hasOwn(scenario.people, value);

export function fakeViewFor(pathname: string, search: Record<string, unknown>): FakeView {
  const persona = search["as"];
  if (isPersona(persona)) return { viewer: persona, firstWeek: false };
  if (pathname === "/" && search["scene"] === "new") return { viewer: "LM", firstWeek: true };
  if (pathname === "/admin") return { viewer: "DH", firstWeek: false };
  if (pathname === "/sign-in" && search["scene"] === "noaccess") {
    return { viewer: "AK", firstWeek: false };
  }
  if (pathname === "/admin") return { viewer: "DH", firstWeek: false };
  if (pathname === "/sign-in" && search["scene"] === "noaccess") {
    return { viewer: "AK", firstWeek: false };
  }
  if (pathname === "/my-work") {
    if (search["scene"] === "anna") return { viewer: "AK", firstWeek: false };
    const tab = search["tab"] ?? search["scene"];
    if (tab === "assigned") return { viewer: "DH", firstWeek: false };
  }
  if (pathname === "/team") return { viewer: "DH", firstWeek: false };
  if (/^\/tasks\/[^/]+\/disagreements\/?$/.test(pathname)) {
    const adjudicating = search["scene"] === "adjudicate" || search["scene"] === "adjdone";
    return { viewer: adjudicating ? "AK" : "DH", firstWeek: false };
  }
  if (/^\/tasks\/[^/]+\/(sign-off|evaluation)\/?$/.test(pathname)) {
    return { viewer: "DH", firstWeek: false };
  }
  if (
    pathname.endsWith("/report") &&
    (search["scene"] === "cosign" || search["scene"] === "sent")
  ) {
    return { viewer: "TB", firstWeek: false };
  }
  if (/^\/projects\/[^/]+\/(run-model|jobs\/[^/]+)\/?$/.test(pathname)) {
    return { viewer: "DH", firstWeek: false };
  }
  return defaultFakeView;
}
