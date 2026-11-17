import { Trans, useLingui } from "@lingui/react/macro";
import { type Project, setProjectMember } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { failureText } from "./new-forms-model.ts";
import { usePeople } from "./people.ts";

export function AddPersonDialog({
  project,
  userId,
  toast,
  onClose,
}: {
  project: Project;
  userId: string;
  toast: (message: ReactNode) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const people = usePeople();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const person = people.byId(userId);
  const add = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      await setProjectMember(project.id, userId, { role: "reviewer" });
      toast(t`${person.name} is a reviewer in ${project.code}`);
      onClose();
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
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t`Add ${person.name} to ${project.code}?`}
      subtitle={t`They asked for access. They join as a reviewer and see this project from then on.`}
      primaryLabel={t`Add as reviewer`}
      primaryBusy={busy}
      onPrimary={() => void add()}
      onCancel={onClose}
    >
      {failure ? (
        <p role="alert" className="text-body-sm text-danger">
          {failure}
        </p>
      ) : (
        <p className="text-body-sm text-fg-dim">
          <Trans>You can change their role later in the project settings.</Trans>
        </p>
      )}
    </SmallModal>
  );
}
