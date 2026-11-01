export type ReportDocumentModel = {
  status: "draft" | "final" | "amended";
  lab: { name: string; department: string; address: string; footer: string };
  head: [string, string][];
  amendment?:
    | {
        title: string;
        reason: string;
        changes: [string, string | null, string | null][];
        note: string;
      }
    | undefined;
  sections: { title: string; body?: string | undefined; diagnosis?: boolean | undefined }[];
  synopticTitle: string;
  standards: [string, string][];
  rows: [string, string][];
  after: { title: string; body: string }[];
  sign: { by: string; at: string } | null;
};
