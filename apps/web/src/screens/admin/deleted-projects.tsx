import { undeleteProject, useListDeletedProjects } from "@parfocal/api-client";
import { NameCell } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { relativeDay } from "../format.ts";
import { projectColour } from "../palette.ts";
import { okData } from "../placeholder.tsx";
import { failureText } from "../project/new-forms-model.ts";
import { type Notify, tableClass } from "./common.tsx";

export function DeletedProjectsZone({ notify }: { notify: Notify }) {
  const queryClient = useQueryClient();
  const deleted = okData(useListDeletedProjects().data) ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (id: string, code: string, name: string) => {
    setBusy(id);
    try {
      await undeleteProject(id);
      await queryClient.invalidateQueries();
      notify(`${code} ${name} is back in every list.`);
    } catch (error) {
      notify(failureText(error).failure);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Zone
      title="Deleted projects"
      end={<span className="text-body-sm text-fg-dim">{deleted.length} deleted</span>}
    >
      {deleted.length === 0 ? (
        <p className="m-0 px-4 py-3 text-body-sm text-fg-dim" data-testid="deleted-projects-empty">
          Projects you delete wait here until you restore them. Only owners see this list.
        </p>
      ) : (
        <Table className={tableClass} data-testid="deleted-projects">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deleted.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <NameCell
                    lead={
                      <i
                        aria-hidden="true"
                        className="block size-3 rounded-[3px]"
                        style={{ background: projectColour(project.colour) }}
                      />
                    }
                    title={project.name}
                    sub={<span className="font-mono">{project.code}</span>}
                  />
                </TableCell>
                <TableCell>{relativeDay(new Date(project.deleted_at), new Date())}</TableCell>
                <TableCell>
                  <span className="flex items-center justify-end">
                    <Button
                      size="sm"
                      disabled={busy === project.id}
                      aria-label={`Restore ${project.name}`}
                      onClick={() => void restore(project.id, project.code, project.name)}
                    >
                      Restore
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Zone>
  );
}
