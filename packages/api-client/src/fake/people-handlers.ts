import { HttpResponse, http, type RequestHandler } from "msw";
import { getGetMemberOpenWorkMockHandler } from "../generated/api.msw.ts";
import type { DeactivationDraft, OpenWork } from "../generated/api.ts";
import { problemMediaType } from "../problem.ts";
import { changedMember, dropLeaving, keepLeaving } from "./people-actions.ts";
import { toMembers } from "./scenario-handlers.ts";

const userIdFromPath = (url: string) => url.split("/members/")[1]?.split("/")[0] ?? "";

const openWorkOf = (userId: string): OpenWork => {
  const member = toMembers()
    .map(changedMember)
    .find((one) => one.user_id === userId);
  return {
    user_id: userId,
    items:
      member?.role === "reviewer"
        ? [
            {
              kind: "review-slides",
              id: `${userId}-review-slides`,
              task_id: null,
              label: "Slides to review in P07",
              count: 3,
            },
          ]
        : [],
  };
};

const refusal = (status: number, title: string, code: string, current?: unknown) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(current === undefined ? {} : { current }) },
    { status, headers: { "content-type": problemMediaType } },
  );

export function peopleHandlers(): RequestHandler[] {
  return [
    getGetMemberOpenWorkMockHandler(({ request }) => openWorkOf(userIdFromPath(request.url))),
    http.post("*/api/tenant/members/:userId/deactivation", async ({ request }) => {
      const userId = userIdFromPath(request.url);
      const draft = (await request.json()) as DeactivationDraft;
      const work = openWorkOf(userId);
      const covered = new Set((draft.handovers ?? []).map((handover) => handover.id));
      if (work.items.some((item) => !covered.has(item.id))) {
        return refusal(409, "Hand over the open work first", "open-work", work);
      }
      const endsOn = draft.ends_on ?? null;
      const deactivation = {
        user_id: userId,
        state: endsOn === null ? ("deactivated" as const) : ("scheduled" as const),
        ends_on: endsOn,
        handed_over: work.items.reduce((sum, item) => sum + item.count, 0),
      };
      keepLeaving(deactivation);
      return HttpResponse.json(deactivation);
    }),
    http.delete("*/api/tenant/members/:userId/deactivation", ({ request }) => {
      dropLeaving(userIdFromPath(request.url));
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
