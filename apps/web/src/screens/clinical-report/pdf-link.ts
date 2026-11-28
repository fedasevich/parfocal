import { getDownloadCaseReportPdfUrl } from "@parfocal/api-client";

export const readerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const reportPdfUrl = (
  projectId: string,
  caseId: string,
  number: number,
  zone: string = readerZone(),
) => getDownloadCaseReportPdfUrl(projectId, caseId, number, { zone });
