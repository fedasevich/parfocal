import type { Me } from "@parfocal/api-client";

export type AdminAccess = "granted" | "reviewer" | "researcher-without-rights";

export function adminAccessOf(me: Me): AdminAccess {
  const membership = me.workspaces.find((item) => item.tenant_id === me.active_tenant_id);
  if (membership === undefined || membership.role === "reviewer") return "reviewer";
  return membership.admin_rights ? "granted" : "researcher-without-rights";
}

export function canOpenAdmin(me: Me | undefined): boolean {
  return me !== undefined && adminAccessOf(me) === "granted";
}

export const refusalOf = (access: Exclude<AdminAccess, "granted">) =>
  access === "reviewer"
    ? {
        title: "The admin page is for people with admin rights",
        body: "Reviewers review the slides of their tasks. Ask a researcher with admin rights in this workspace if something needs setting up.",
      }
    : {
        title: "You do not have admin rights in this workspace",
        body: "Admin rights let a researcher invite people, connect models and storage and read the audit log. Ask a researcher who holds them to give them to you.",
      };
