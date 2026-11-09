import { deleteProject, type Project } from "@parfocal/api-client";
import { Input } from "@parfocal/ui/components/input";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { failureText } from "./new-forms-model.ts";
import {
  type DeleteCounts,
  deleteBlockers,
  deletedToast,
  deleteTitle,
  keptNote,
  whatGoes,
} from "./project-delete-model.ts";

export function ProjectDeleteDialog({
  project,
  counts,
  toast,
  onClose,
}: {
  project: Project;
  counts: DeleteCounts;
  toast: (message: ReactNode) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const lines = whatGoes(counts);
  const blockers = deleteBlockers(typed, project.name).map((text, index) => ({
    id: `delete-${index}`,
    text,
    goTo: "Go to the field",
  }));
  const confirm = async () => {
    setTried(true);
    if (blockers.length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await deleteProject(project.id, { name: typed.trim() });
      toast(deletedToast(project.code, project.name));
      onClose();
      await navigate({ to: "/" });
      await queryClient.invalidateQueries();
    } catch (error) {
      setFailure(failureText(error).failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SmallModal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={deleteTitle(project.code)}
      subtitle={`${project.name} leaves every list and link for every member.`}
      hint={
        failure ? (
          <span role="alert" className="text-bad">
            {failure}
          </span>
        ) : (
          "The delete is kept in the audit log."
        )
      }
      primaryLabel="Delete project"
      primaryBusy={busy}
      blockers={tried ? blockers : []}
      blockersTitle="Before you can delete it"
      onPrimary={() => void confirm()}
    >
      <div className="grid gap-3 text-body-sm text-fg">
        {lines.length > 0 ? (
          <div className="grid gap-1">
            <span className="text-fg-dim">Hidden with it</span>
            <ul className="m-0 grid list-disc gap-0.5 pl-5" data-testid="project-delete-goes">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="m-0 text-fg-dim">{keptNote}</p>
        <div className="grid gap-1 text-fg-dim">
          <label htmlFor="project-delete-name">
            Type <b className="text-fg">{project.name}</b> to confirm
          </label>
          <Input
            id="project-delete-name"
            value={typed}
            autoComplete="off"
            maxLength={120}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </div>
    </SmallModal>
  );
}
