export type ResultUpload = {
  uploadId: string;
  name: string;
  status: string;
  reason: string | null;
  message: string | null;
};

export const waitsForChoices = (upload: ResultUpload) =>
  upload.status === "waiting" && upload.reason === "needs-choices";

export const notStored = (upload: ResultUpload) =>
  upload.status === "failed" && upload.reason === "result-heatmap-not-stored";

export const openResultProblems = (uploads: readonly ResultUpload[]) =>
  uploads.filter((upload) => waitsForChoices(upload) || notStored(upload)).length;
