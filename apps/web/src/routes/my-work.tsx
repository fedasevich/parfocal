import { useListMyReviewTasks } from "@parfocal/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { okData, Placeholder, QueryState } from "../screens/placeholder.tsx";

const myWorkSearch = z.object({
  tab: z.enum(["review", "assigned", "all"]).default("review"),
});

export const Route = createFileRoute("/my-work")({
  validateSearch: myWorkSearch,
  component: MyWork,
});

function MyWork() {
  const search = Route.useSearch();
  const tasks = useListMyReviewTasks();
  return (
    <Placeholder
      title="My work"
      builtBy="PROTO-003 (Home, My work and the shell)"
      route={{ search }}
    >
      <QueryState label="your review tasks" isPending={tasks.isPending} error={tasks.error}>
        <ul className="flex flex-col gap-1 text-fg text-sm">
          {okData(tasks.data)?.map((task) => (
            <li key={task.id}>
              {task.code} · {task.name} · {task.slides_submitted} of {task.slides_assigned}
            </li>
          ))}
        </ul>
      </QueryState>
    </Placeholder>
  );
}
