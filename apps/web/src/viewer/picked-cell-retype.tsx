import { Trans } from "@lingui/react/macro";
import { changeAiObject, type ProjectClass, useListProjectClasses } from "@parfocal/api-client";
import { useMemo, useState } from "react";
import { type AnnotateTask, taskClassesOf } from "../annotations/annotate-task.ts";
import { okData } from "../screens/placeholder.tsx";
import type { PickedCell } from "./result-cell-pick.ts";

export type CellRetype = {
  readonly taskId: string;
  readonly slideId: string;
  readonly resultSetId: string;
  readonly classes: readonly ProjectClass[];
};

export function useCellRetype(projectId: string, task: AnnotateTask | null): CellRetype | null {
  const listed = useListProjectClasses(projectId, {
    query: { enabled: task !== null && task.classes === null },
  });
  const fetched = okData(listed.data);
  return useMemo(() => {
    if (task === null || task.resultSetId === null) return null;
    return {
      taskId: task.taskId,
      slideId: task.slideId,
      resultSetId: task.resultSetId,
      classes: taskClassesOf(task.classes, fetched ?? []),
    };
  }, [task, fetched]);
}

export type RetypeState = "idle" | "saving" | "saved" | "failed";

export function aiCellChange(cell: PickedCell, classId: string) {
  const points: [number, number][] = [];
  for (let at = 0; at + 1 < cell.ring.length; at += 2) {
    points.push([cell.ring[at] ?? 0, cell.ring[at + 1] ?? 0]);
  }
  const first = points[0] ?? [0, 0];
  return {
    object: `C${cell.number}`,
    body: {
      class_id: classId,
      geometry: { type: "Polygon" as const, coordinates: [[...points, first]] },
    },
  };
}

export function RetypeAiCell({
  retype,
  cell,
  onTyped,
}: {
  retype: CellRetype;
  cell: PickedCell;
  onTyped: (name: string) => void;
}) {
  const [state, setState] = useState<RetypeState>("idle");
  const save = (picked: ProjectClass) => {
    const { object, body } = aiCellChange(cell, picked.id);
    setState("saving");
    void changeAiObject(retype.taskId, retype.slideId, object, body).then(
      (response) => {
        if (response.status !== 201) return setState("failed");
        setState("saved");
        onTyped(picked.name);
      },
      () => setState("failed"),
    );
  };
  return (
    <div className="grid gap-1.5" data-testid="picked-cell-retype" data-state={state}>
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="mb-1.5 text-fg-dim">
          <Trans>Change its type in this task</Trans>
        </legend>
        {retype.classes.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid="picked-cell-class"
            data-class={item.id}
            disabled={state === "saving"}
            aria-pressed={cell.typeName === item.name}
            className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-fg hover:bg-chrome-2 aria-pressed:border-accent disabled:opacity-60"
            onClick={() => save(item)}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: item.colour }}
            />
            {item.name}
          </button>
        ))}
      </fieldset>
      {state === "failed" ? (
        <p className="text-danger" role="alert">
          <Trans>The type was not saved. Try again.</Trans>
        </p>
      ) : null}
    </div>
  );
}
