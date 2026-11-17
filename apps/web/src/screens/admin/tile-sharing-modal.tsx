import { Trans, useLingui } from "@lingui/react/macro";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";

export function TileSharingModal({
  projectName,
  host,
  busy = false,
  onClose,
  onConfirm,
}: {
  projectName: string;
  host: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLingui();

  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={480}
      title={t`Send tiles of ${projectName} to ${host}?`}
      subtitle={t`${projectName} is a clinical project`}
      cancelLabel={t`Cancel`}
      onCancel={onClose}
      primaryLabel={t`Send tiles to this server`}
      primaryBusy={busy}
      onPrimary={onConfirm}
      hint={t`Parfocal records your confirmation. Removing the model from the project clears it.`}
    >
      <SmallModalZone title={t`What leaves Parfocal`}>
        <p className="text-body-sm text-fg">
          <Trans>
            Each run of this model sends tiles of the project's slides to {host}. The lab that runs
            the server sees them. Slide labels and patient details are never sent.
          </Trans>
        </p>
      </SmallModalZone>
    </SmallModal>
  );
}
