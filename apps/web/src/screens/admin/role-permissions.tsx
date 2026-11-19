import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { Zone } from "@parfocal/ui/components/zone";
import { tableClass } from "./common.tsx";
import {
  type GrantCode,
  type PermissionKey,
  permissionColumns,
  permissionRows,
} from "./permission-table.ts";

const actionNames: Record<PermissionKey, MessageDescriptor> = {
  "see-slides": msg`See projects, cases and slides`,
  "see-labels": msg`See slide label and macro images, only in clinical projects`,
  "emergency-access": msg`Open a clinical project they are not in`,
  "create-cases": msg`Create projects and cases, edit their details`,
  "privacy-mode": msg`Change the privacy mode of a project they own, with a reason`,
  "upload-slides": msg`Upload slides and AI results, fix unmatched files`,
  "move-slides": msg`Move a slide between cases`,
  "run-models": msg`Run AI models on slides, cancel, resume and retry the runs`,
  review: msg`Give decisions, annotate, fix results, comment`,
  "set-own-status": msg`Set their own status`,
  "see-people": msg`See the workspace's people and their status`,
  "manage-people": msg`Invite people, change roles and admin rights`,
  "workspace-settings": msg`Workspace settings and session security`,
  integrations: msg`Storage, sources, API and webhooks`,
  "report-templates": msg`Use report templates, edit the library`,
  "audit-log": msg`Audit log`,
  "developer-mode": msg`Developer mode and API tokens`,
};

const grantNames: Record<GrantCode, MessageDescriptor> = {
  y: msg`Yes`,
  o: msg`In their tasks`,
  r: msg`View only`,
  b: msg`Emergency, with reason`,
  n: msg`No`,
};

export function RolePermissionsZone() {
  const { t } = useLingui();
  return (
    <Zone
      title={t`What each role may do`}
      sub={t`Read from the permission matrix the server enforces. Reviewers are the doctors who review and annotate, so annotating sits under Reviewer. A researcher with admin rights gets the researcher's column and yes wherever the admin rights column says yes.`}
    >
      <Table className={tableClass} aria-label={t`What each role may do`}>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Trans>Action</Trans>
            </TableHead>
            <TableHead>
              <Trans>Researcher</Trans>
            </TableHead>
            <TableHead>
              <Trans>Reviewer, reviews and annotates</Trans>
            </TableHead>
            <TableHead>
              <Trans>Added by admin rights</Trans>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {permissionRows().map((row) => (
            <TableRow key={row.key} data-permission={row.key}>
              <TableCell className="py-2 whitespace-normal">{t(actionNames[row.key])}</TableCell>
              {permissionColumns.map((column) => (
                <TableCell
                  key={column}
                  className={row.grants[column] === "n" ? "text-fg-faint" : undefined}
                >
                  {t(grantNames[row.grants[column]])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Zone>
  );
}
