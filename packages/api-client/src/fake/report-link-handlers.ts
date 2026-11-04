import { HttpResponse, http, type RequestHandler } from "msw";
import type { CreatedReportLink, ReportLink, SharedReport } from "../generated/api.ts";
import { toTaskEvaluation } from "./adjudication-handlers.ts";
import { people, projectByCode, reviewTasks } from "./scenario.ts";

type StoredLink = ReportLink & { token: string };

const lifetimeDays = 30;
const links = new Map<string, StoredLink>();

export function resetFakeReportLinks(): void {
  links.clear();
}

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const notFound = () => problem(404, "not-found", "Not found");

const isExpired = (link: ReportLink) => Date.parse(link.expires_at) <= Date.now();

const listed = ({ token: _token, ...link }: StoredLink): ReportLink => ({
  ...link,
  expired: isExpired(link),
});

export function sharedReportOf(taskId: string): SharedReport | null {
  const task = reviewTasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) return null;
  const {
    task_id: _task,
    presets: _presets,
    display: _display,
    ...rest
  } = toTaskEvaluation(taskId);
  const reviewers = [...new Set(rest.kappa.flatMap((pair) => [pair.first, pair.second]))].sort();
  const letter = (id: string) => `Reviewer ${String.fromCharCode(65 + reviewers.indexOf(id))}`;
  return {
    project_name: projectByCode(task.project).name,
    task_name: task.name,
    expires_at: new Date(Date.now() + lifetimeDays * 86_400_000).toISOString(),
    evaluation: {
      ...rest,
      kappa: rest.kappa.map((pair) => ({
        ...pair,
        first: letter(pair.first),
        second: letter(pair.second),
      })),
      opinions: rest.opinions.map(({ texts: _texts, ...opinion }) => opinion),
    },
  };
}

export function reportLinkHandlers(): RequestHandler[] {
  return [
    http.post("*/api/review-tasks/:taskId/evaluation/links", ({ params, request }) => {
      const taskId = String(params.taskId);
      if (!reviewTasks.some((candidate) => candidate.id === taskId)) return notFound();
      const now = new Date();
      const token = crypto.randomUUID().replaceAll("-", "");
      const link: StoredLink = {
        id: crypto.randomUUID(),
        task_id: taskId,
        created_by: people.DH.id,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + lifetimeDays * 86_400_000).toISOString(),
        revoked_at: null,
        expired: false,
        opened_count: 0,
        last_opened_at: null,
        token,
      };
      links.set(link.id, link);
      const created: CreatedReportLink = {
        ...listed(link),
        token,
        url: `${new URL(request.url).origin}/shared-reports/${token}`,
      };
      return HttpResponse.json(created, { status: 201 });
    }),
    http.get("*/api/review-tasks/:taskId/evaluation/links", ({ params }) =>
      HttpResponse.json(
        [...links.values()].filter((link) => link.task_id === params.taskId).map(listed),
      ),
    ),
    http.delete("*/api/review-tasks/:taskId/evaluation/links/:linkId", ({ params }) => {
      const link = links.get(String(params.linkId));
      if (link === undefined || link.task_id !== params.taskId) return notFound();
      link.revoked_at ??= new Date().toISOString();
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("*/api/shared-reports/:token", ({ params }) => {
      const link = [...links.values()].find((candidate) => candidate.token === params.token);
      if (link === undefined) return notFound();
      if (link.revoked_at !== null || isExpired(link))
        return problem(410, "report-link-gone", "This report link was revoked or has expired");
      const report = sharedReportOf(link.task_id);
      if (report === null) return notFound();
      link.opened_count += 1;
      link.last_opened_at = new Date().toISOString();
      return HttpResponse.json({ ...report, expires_at: link.expires_at });
    }),
  ];
}
