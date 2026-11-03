import { type AssignedTask, useGetReviewTask, useGetReviewTaskStates } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag, type StatusTone } from "@parfocal/ui/components/tag";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDayMonth, formatDue, percent } from "../format.ts";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { SetChip, useSetLook } from "./parts.tsx";

function statusOf(task: AssignedTask, signedOn: string | null): [string, StatusTone] {
  switch (task.status) {
    case "disagreements":
      return [`${task.open_disagreements} disagreements`, "warn"];
    case "ready-to-sign-off":
      return ["Ready to sign off", "ok"];
    case "signed-off":
      return [signedOn ? `Signed off ${signedOn}` : "Signed off", "ok"];
    case "in-review":
      return ["In review", "accent"];
    case "not-started":
      return ["Not started", "neutral"];
  }
}

function AssignedRow({
  task,
  selected,
  onSelect,
}: {
  task: AssignedTask;
  selected: boolean;
  onSelect: () => void;
}) {
  const goTo = useGoTo();
  const people = usePeople();
  const detail = okData(useGetReviewTask(task.id).data);
  const look = useSetLook(task.project.id);
  const setId = detail?.slides[0]?.result_set_id;
  const set = setId ? look({ id: setId, name: "" }) : undefined;
  const signed = task.status === "signed-off";
  const states = okData(useGetReviewTaskStates(task.id, { query: { enabled: signed } }).data);
  const signedOn = states?.signed_off_at ? formatDayMonth(new Date(states.signed_off_at)) : null;
  const [label, tone] = statusOf(task, signedOn);
  const busy = task.status === "in-review" || task.status === "not-started";
  const behindmost = task.reviewers.reduce<(typeof task.reviewers)[number] | undefined>(
    (worst, reviewer) =>
      worst === undefined ||
      reviewer.slides_assigned - reviewer.slides_submitted >
        worst.slides_assigned - worst.slides_submitted
        ? reviewer
        : worst,
    undefined,
  )?.user_id;
  const teamRow = (scene: "nudge" | "reassign") =>
    destinations.team({ scene, task: task.id, focus: behindmost });
  return (
    <tr
      aria-selected={selected}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a")) return;
        onSelect();
      }}
      className={`cursor-pointer border-line border-b ${selected ? "bg-accent-soft" : ""}`}
    >
      <td className="px-2 py-(--density-cell-y) align-middle">
        <b className="font-mono font-medium text-fg">{task.code}</b>{" "}
        <b className="font-medium text-fg">{task.name}</b>
        <small className="block text-caption text-fg-dim">
          {task.project.name}
          {detail ? ` · ${detail.slide_count} slides${detail.blinded ? " · blind" : ""}` : ""}
        </small>
      </td>
      <td className="px-2 py-(--density-cell-y) align-middle">
        {set?.label ? <SetChip label={set.label} source={set.source} /> : null}
      </td>
      <td className="px-2 py-(--density-cell-y) align-middle">
        <div className="grid gap-1">
          {task.reviewers.map((reviewer) => (
            <div key={reviewer.user_id} className="flex items-center gap-2 text-caption">
              <Person {...personProp(people(reviewer.user_id))} size={20} />
              <ProgressBar
                className="w-17.5"
                value={percent(reviewer.slides_submitted, reviewer.slides_assigned)}
                aria-label={`${people(reviewer.user_id)?.name ?? "Reviewer"}, ${reviewer.slides_submitted} of ${reviewer.slides_assigned} slides`}
              />
              <span className="font-mono text-fg-dim">
                {reviewer.slides_submitted}/{reviewer.slides_assigned}
              </span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-2 py-(--density-cell-y) align-middle text-fg-dim">
        {task.due_on ? formatDue(task.due_on) : "No due date"}
      </td>
      <td className="px-2 py-(--density-cell-y) align-middle">
        <StatusTag tone={tone}>{label}</StatusTag>
      </td>
      <td className="px-2 py-(--density-cell-y) align-middle">
        <div className="flex justify-end gap-1.5">
          {task.status === "disagreements" ? (
            <Button
              variant="primary"
              onClick={() => void goTo(destinations.disagreements(task.id))}
            >
              Resolve
            </Button>
          ) : null}
          {task.status === "ready-to-sign-off" ? (
            <Button variant="primary" onClick={() => void goTo(destinations.signOff(task.id))}>
              Sign off
            </Button>
          ) : null}
          {busy ? (
            <>
              <Button onClick={() => void goTo(teamRow("nudge"))}>
                <Icon name="bell" />
                Nudge
              </Button>
              <Button
                onClick={() => void goTo(teamRow("reassign"))}
                title={
                  behindmost
                    ? `Reassign from ${people(behindmost)?.name ?? "a reviewer"}`
                    : undefined
                }
              >
                Reassign
              </Button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function AssignedTab({
  tasks,
  selected,
  onSelect,
}: {
  tasks: AssignedTask[];
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}) {
  const goTo = useGoTo();
  const firstProject = tasks[0]?.project.id;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <Button
          variant="primary"
          onClick={() =>
            firstProject ? void goTo(destinations.newReviewTask(firstProject)) : undefined
          }
        >
          <Icon name="users" />
          New review task
        </Button>
      </div>
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="text-left text-caption text-fg-dim">
            {["Task", "Result set", "Reviewers", "Due", "Status", ""].map((heading) => (
              <th
                key={heading || "actions"}
                className="whitespace-nowrap border-line-strong border-b px-2 py-1.75 font-semibold"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <AssignedRow
              key={task.id}
              task={task}
              selected={task.id === selected}
              onSelect={() => onSelect(task.id)}
            />
          ))}
        </tbody>
      </table>
      {tasks.length === 0 ? (
        <p className="text-body-sm text-fg-dim">
          You have not handed out any review tasks yet. New review task starts one.
        </p>
      ) : null}
    </div>
  );
}
