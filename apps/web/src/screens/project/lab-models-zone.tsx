import { Trans, useLingui } from "@lingui/react/macro";
import {
  getListProjectLabModelsQueryKey,
  type Project,
  type ProjectLabModel,
  useConfirmLabModelTileSharing,
  useListProjectLabModels,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { TileSharingModal } from "../admin/tile-sharing-modal.tsx";
import { okData } from "../placeholder.tsx";

export function LabModelsZone({
  project,
  toast,
}: {
  project: Project;
  toast: (message: ReactNode) => void;
}) {
  const { t } = useLingui();

  const models = okData(useListProjectLabModels(project.id).data) ?? [];
  const confirm = useConfirmLabModelTileSharing();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<ProjectLabModel | null>(null);
  if (models.length === 0) return null;
  const owns = project.my_role === "owner";
  const pending = models.filter((model) => model.confirmed_at === null);
  return (
    <Zone
      title={t`Lab models`}
      aria-label={t`Lab models`}
      highlight={owns && pending.length > 0 ? "warn" : false}
    >
      <Hint>
        {pending.length === 0 ? (
          <Trans>Tiles of this project's slides go to these servers when the models run.</Trans>
        ) : owns ? (
          <Trans>A lab model was added. It runs here only after you confirm its server.</Trans>
        ) : (
          <Trans>A lab model waits for the project owner to confirm its server.</Trans>
        )}
      </Hint>
      {models.map((model) => (
        <div
          key={model.id}
          className="flex min-h-10 items-center gap-2.5 border-line text-body-sm [&+&]:border-t"
        >
          <Icon name="database" className="text-fg-dim" />
          <b className="font-semibold text-fg">
            {model.name} {model.version}
          </b>
          <span className="flex-1 font-mono text-caption text-fg-dim">{model.host}</span>
          {model.confirmed_at !== null ? (
            <span className="text-caption text-fg-dim">
              <Trans>Confirmed</Trans>
            </span>
          ) : owns ? (
            <Button size="sm" variant="primary" onClick={() => setAsking(model)}>
              <Trans>Confirm tile sharing</Trans>
            </Button>
          ) : (
            <span className="text-caption text-fg-dim">
              <Trans>Waiting for the owner</Trans>
            </span>
          )}
        </div>
      ))}
      {asking && (
        <TileSharingModal
          projectName={project.name}
          host={asking.host}
          busy={confirm.isPending}
          onClose={() => setAsking(null)}
          onConfirm={() =>
            confirm.mutate(
              { modelId: asking.id, projectId: project.id },
              {
                onSuccess: (answer) => {
                  setAsking(null);
                  if (answer.status !== 200) {
                    toast(t`The confirmation was not saved. Try again.`);
                    return;
                  }
                  void queryClient.invalidateQueries({
                    queryKey: getListProjectLabModelsQueryKey(project.id),
                  });
                  toast(t`${asking.name} ${asking.version} can now run in this project.`);
                },
                onError: () => toast(t`The confirmation was not saved. Try again.`),
              },
            )
          }
        />
      )}
    </Zone>
  );
}
