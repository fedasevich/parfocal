import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetProjectImportsQueryKey,
  useListImportSources,
  useStopWatchingSource,
  useWatchSource,
  type WatchedFolder as WatchedFolderState,
} from "@parfocal/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Switch } from "@parfocal/ui/components/switch";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { Field, ReadOnly } from "./parts.tsx";

type Problem = { detail?: string | null; title?: string };

export function WatchedFolder({
  projectId,
  projectCode,
  folder,
}: {
  projectId: string;
  projectCode: string;
  folder: WatchedFolderState;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const sources = okData(useListImportSources().data)?.sources ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const watching = useWatchSource();
  const stopping = useStopWatchingSource();
  const busy = watching.isPending || stopping.isPending;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetProjectImportsQueryKey(projectId) });
  const failed = (data: unknown) => {
    const problem = data as Problem | undefined;
    setRefusal(problem?.detail ?? problem?.title ?? t`The watched folder could not be changed.`);
  };
  const turn = (on: boolean) => {
    setRefusal(null);
    if (on && chosen !== null) {
      watching.mutate(
        { projectId, data: { source_id: chosen } },
        { onSuccess: (result) => (result.status === 200 ? refresh() : failed(result.data)) },
      );
    }
    if (!on) {
      stopping.mutate(
        { projectId },
        { onSuccess: (result) => (result.status === 204 ? refresh() : failed(result.data)) },
      );
    }
  };
  return (
    <Zone
      title={t`Watched folder`}
      sub={t`New files in this folder arrive in ${projectCode} on their own, checked like an upload.`}
      end={
        <Switch
          checked={folder.on}
          disabled={busy || (!folder.on && chosen === null)}
          onCheckedChange={turn}
          aria-label={t`Watched folder on`}
        />
      }
    >
      {folder.on ? (
        <>
          <Field label={t`Folder`}>
            <ReadOnly
              value={folder.address}
              end={
                <StatusTag tone="ok">
                  <Trans>Connected</Trans>
                </StatusTag>
              }
            />
          </Field>
          <span className="text-body-sm text-fg">
            <Trans>Looks for new files every {folder.every}.</Trans>
          </span>
        </>
      ) : (
        <Field label={t`Source to watch`}>
          <Select
            value={chosen}
            onValueChange={setChosen}
            items={sources.map((source) => ({ value: source.id, label: source.name }))}
          >
            <SelectTrigger aria-label={t`Source to watch`} className="w-full">
              <SelectValue placeholder={t`Choose a saved source`} />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {refusal ? (
        <Hint>
          <span role="alert">{refusal}</span>
        </Hint>
      ) : null}
    </Zone>
  );
}
