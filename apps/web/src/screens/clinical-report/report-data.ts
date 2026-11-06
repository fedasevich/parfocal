import {
  ApiError,
  addCaseReportDeposit,
  type CaseReport,
  createCaseReport,
  getCaseReport,
  getGetCaseReportQueryKey,
  removeCaseReportDeposit,
  updateCaseReport,
  useGetCase,
  useGetCaseReportVersion,
  useGetMe,
  useGetProject,
} from "@parfocal/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { okData } from "../placeholder.tsx";
import { type Assembly, assembleReport } from "./case-report.ts";
import type { ReportWriter } from "./report-sync.ts";

export type LoadedReport = Assembly & { server: CaseReport };

async function loadReport(projectId: string, caseId: string): Promise<CaseReport> {
  try {
    const found = await getCaseReport(projectId, caseId);
    if (found.status === 200) return found.data;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  const created = await createCaseReport(projectId, caseId);
  if (created.status !== 201) throw new Error("The report was not created");
  return created.data;
}

export function useCaseReportData(projectId: string, caseId: string) {
  const report = useQuery({
    queryKey: getGetCaseReportQueryKey(projectId, caseId),
    queryFn: () => loadReport(projectId, caseId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const caseQuery = useGetCase(caseId);
  const project = useGetProject(projectId);
  const me = useGetMe();
  const server = report.data;
  const first = useGetCaseReportVersion(projectId, caseId, 1, {
    query: { enabled: server !== undefined && server.versions.length > 1 },
  });
  const caseDetail = okData(caseQuery.data);
  const projectDetail = okData(project.data);
  const user = okData(me.data);
  const firstVersion = okData(first.data) ?? null;
  const waitingForFirst = server !== undefined && server.versions.length > 1 && first.isPending;
  const loaded = useMemo<LoadedReport | undefined>(() => {
    if (!server || !caseDetail || !projectDetail || !user || waitingForFirst) return undefined;
    return {
      ...assembleReport({
        project: projectDetail,
        caseDetail,
        server,
        userId: user.user_id,
        first: firstVersion,
      }),
      server,
    };
  }, [server, caseDetail, projectDetail, user, firstVersion, waitingForFirst]);
  return {
    loaded,
    pending: !loaded && !(report.error ?? caseQuery.error ?? project.error ?? me.error),
    failed: Boolean(report.error ?? caseQuery.error ?? project.error ?? me.error),
  };
}

export function useReportWriter(projectId: string, caseId: string) {
  const client = useQueryClient();
  const key = getGetCaseReportQueryKey(projectId, caseId);
  const keep = (response: { status: number; data: unknown }) => {
    const next = response.data as CaseReport;
    client.setQueryData(key, next);
    return next;
  };
  const writer: ReportWriter = {
    patch: async (change) => keep(await updateCaseReport(projectId, caseId, change)),
    add: async (deposit) => keep(await addCaseReportDeposit(projectId, caseId, deposit)),
    remove: async (id) => keep(await removeCaseReportDeposit(projectId, caseId, id)),
  };
  return { writer, keep };
}
