import { useLingui } from "@lingui/react/macro";
import { deleteResultSet, type ResultSet } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type DeleteFailure, deleteFailure } from "./result-set-delete-model.ts";

export function ResultSetDeleteDialog({ set, onClose }: { set: ResultSet; onClose: () => void }) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeleteFailure | undefined>();
  const confirmed = failure?.needsConfirm === true;
  const remove = async () => {
    setBusy(true);
    try {
      await deleteResultSet(set.id, { confirm: confirmed });
      onClose();
      await queryClient.invalidateQueries();
    } catch (error) {
      setFailure(deleteFailure(error));
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
      title={t`Delete ${set.name}?`}
      subtitle={t`It leaves this slide and the viewer. The delete is kept in the audit log.`}
      hint={
        failure ? (
          <span role="alert" className="text-bad">
            {failure.text}
          </span>
        ) : undefined
      }
      primaryLabel={confirmed ? t`Delete anyway` : t`Delete result set`}
      primaryBusy={busy}
      onPrimary={() => void remove()}
    />
  );
}
