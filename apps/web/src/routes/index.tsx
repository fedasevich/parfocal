import { useGetMe, useGetMyHome, useGetSession, useListMyJobs } from "@parfocal/api-client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { okData, Placeholder, QueryState } from "../screens/placeholder.tsx";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const session = useGetSession();
  const me = useGetMe();
  const home = useGetMyHome();
  const jobs = useListMyJobs();
  const homeBody = okData(home.data);
  return (
    <Placeholder
      title="Home"
      builtBy="PROTO-003 (Home, My work and the shell)"
      route={{ path: "/" }}
    >
      <QueryState label="your session" isPending={session.isPending} error={session.error}>
        <p className="text-fg-dim text-sm" data-testid="session-email">
          Session for {okData(session.data)?.email ?? "nobody"}
        </p>
      </QueryState>
      <QueryState label="your profile" isPending={me.isPending} error={me.error}>
        <p className="text-fg" data-testid="signed-in-as">
          Signed in as {okData(me.data)?.display_name}
        </p>
      </QueryState>
      <QueryState label="your home" isPending={home.isPending} error={home.error}>
        <ul className="flex flex-col gap-1 text-fg text-sm">
          {homeBody?.projects.map((project) => (
            <li key={project.id}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="text-accent underline"
              >
                {project.code} · {project.name}
              </Link>
            </li>
          ))}
        </ul>
      </QueryState>
      <QueryState label="your jobs" isPending={jobs.isPending} error={jobs.error}>
        <ul className="flex flex-col gap-1 text-fg-dim text-sm">
          {jobs.data?.data.map((job) => (
            <li key={job.id}>
              {job.title} · {job.status}
            </li>
          ))}
        </ul>
      </QueryState>
    </Placeholder>
  );
}
