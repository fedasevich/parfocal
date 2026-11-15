import { useLingui } from "@lingui/react/macro";
import type { ResultSet } from "@parfocal/api-client";
import { ResultSetRows } from "@parfocal/ui/components/visualize";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { destinations } from "../../shell/destinations.ts";
import { formatDayMonth } from "../format.ts";
import { setColours } from "./layer-views.tsx";

export function ViewerResultSets({
  projectId,
  slideId,
  slideSets,
  taskSetId,
  taskCode,
  setsLock,
  isShown,
  reviewedOn,
  onToggle,
  goView,
}: {
  projectId: string;
  slideId: string;
  slideSets: readonly ResultSet[];
  taskSetId: string | null | undefined;
  taskCode: string | undefined;
  setsLock: { reason: string } | undefined;
  isShown: (key: string) => boolean;
  reviewedOn: boolean;
  onToggle: (key: string, on: boolean) => void;
  goView: (next: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <ResultSetRows
      onToggle={onToggle}
      locked={
        setsLock
          ? {
              reason: t`Locked by ${taskCode ?? "the task"}: ${setsLock.reason.charAt(0).toLowerCase()}${setsLock.reason.slice(1)}`,
            }
          : undefined
      }
      sets={[
        ...slideSets.map((set) => {
          const task = set.id === taskSetId;
          return {
            key: set.id,
            name: `${set.name} ${set.model_version ?? ""}`.trim(),
            sub: `${set.source === "run" ? t`Run here` : t`Imported`} ${formatDayMonth(new Date(set.produced_at ?? set.created_at))}${task ? t` · the result this task checks` : ""}`,
            color: task ? setColours.a : setColours.b,
            fixed: task,
            on: task ? false : setsLock ? false : isShown(set.id),
            menu: [
              {
                icon: "slides" as const,
                label: t`Compare with another set`,
                onSelect: (): void => goView("models"),
              },
              {
                icon: "smart" as const,
                label: set.source === "run" ? t`Run again` : t`Run a model on this slide`,
                onSelect: (): void =>
                  void router.navigate({
                    href: `${destinations.runModel(projectId)}?slides=${encodeURIComponent(JSON.stringify([slideId]))}`,
                  }),
              },
              {
                icon: "upload" as const,
                label: t`Add another result set`,
                onSelect: (): void =>
                  void navigate({
                    to: "/projects/$projectId/upload",
                    params: { projectId },
                    search: { scene: "viewer" },
                  }),
              },
            ],
          };
        }),
        {
          key: "reviewed",
          name: "Your review",
          sub: t`The reviewed layer, as you edit it`,
          color: setColours.reviewed,
          on: reviewedOn,
          menu: [
            {
              icon: "slides" as const,
              label: t`Compare with the AI`,
              onSelect: (): void => goView("diff"),
            },
          ],
        },
      ]}
    />
  );
}
