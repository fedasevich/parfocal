import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CheckedAiObject } from "../annotations/annotate-task.ts";
import { confirmAction } from "../annotations/check-state.ts";
import {
  areaAround,
  checkQueueOf,
  classAction,
  currentOf,
  deleteAction,
  guidedActions,
  nextAction,
  skippedState,
  startState,
} from "../annotations/guided-check.ts";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

type GuidedCheckProps = {
  engine: ViewerEngine;
  objects: readonly CheckedAiObject[];
  locked: boolean;
  canReclass: boolean;
  onCurrent: (object: string | null) => void;
  onConfirm: () => void;
  onDelete: () => void;
  onReclass: () => void;
  onLeave: () => void;
};

export function GuidedCheck({
  engine,
  objects,
  locked,
  canReclass,
  onCurrent,
  onConfirm,
  onDelete,
  onReclass,
  onLeave,
}: GuidedCheckProps) {
  const [state, setState] = useState(startState);
  const queue = useMemo(() => checkQueueOf(objects, state.skipped), [objects, state.skipped]);
  const current = currentOf(queue, state);
  const object = objects.find((item) => item.object === current);

  useLayoutEffect(() => {
    onCurrent(current);
  }, [current, onCurrent]);

  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    if (object === undefined || flownTo.current === object.object) return;
    flownTo.current = object.object;
    const area = areaAround(object.geometry);
    if (area !== null) void engine.flyToArea(area);
  }, [object, engine]);

  const latest = useRef({ queue, state, locked, onDelete, onReclass });
  latest.current = { queue, state, locked, onDelete, onReclass };
  const bindings = useBindings(["annotate"], guidedActions);
  const onFire = useCallback((fired: Fired) => {
    if (fired.phase !== "press") return;
    const now = latest.current;
    if (fired.action === nextAction) setState(skippedState(now.queue, now.state));
    if (now.locked) return;
    if (fired.action === deleteAction) now.onDelete();
    if (fired.action === classAction) now.onReclass();
  }, []);
  useHotkeys(bindings, onFire);

  return (
    <section
      aria-label="Guided check"
      data-testid="guided-check"
      data-current={current ?? ""}
      data-left={queue.length}
      className="grid gap-2 rounded-ctl border border-line bg-chrome-2 p-2"
    >
      <p className="m-0 text-body-sm" data-testid="guided-line">
        {object === undefined
          ? "Every AI object is checked."
          : `${object.object} · ${
              object.score === null ? "no score" : `score ${object.score.toFixed(2)}`
            } · ${queue.length} left`}
      </p>
      {object === undefined ? null : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={locked} onClick={onConfirm}>
            Confirm <Keycap action={confirmAction} keys="D" size="sm" />
          </Button>
          <Button size="sm" disabled={locked || !canReclass} onClick={onReclass}>
            Next class <Keycap action={classAction} keys="⇧Y" size="sm" />
          </Button>
          <Button size="sm" disabled={locked} onClick={onDelete}>
            Delete <Keycap action={deleteAction} keys="⇧X" size="sm" />
          </Button>
          <Button size="sm" onClick={() => setState(skippedState(queue, state))}>
            Skip <Keycap action={nextAction} keys="⇧E" size="sm" />
          </Button>
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={onLeave}>
        Leave the guided check
      </Button>
    </section>
  );
}
