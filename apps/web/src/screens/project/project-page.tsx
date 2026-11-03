import {
  type Project,
  useGetProject,
  useGetProjectOverview,
  useListReviewTasks,
} from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack } from "@parfocal/ui/components/person";
import { TabCount, Tabs, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useFormat } from "../../format.ts";
import { okData } from "../placeholder.tsx";
import { useMockToast } from "./mock-toast.tsx";
import { usePeople } from "./people.ts";
import { SettingsTab } from "./settings-tab.tsx";
import { SlidesTab } from "./slides-tab.tsx";
import { TasksTab } from "./tasks-tab.tsx";

export type ProjectTab = "slides" | "tasks" | "settings";

export type ProjectView = {
  tab: ProjectTab;
  open?: string | undefined;
  importFailed?: boolean | undefined;
  addClass?: boolean | undefined;
};

const privacyTag = (project: Project) =>
  project.privacy_mode === "clinical" ? (
    <StatusTag tone="warn">Clinical</StatusTag>
  ) : (
    <StatusTag tone="accent">De-identified</StatusTag>
  );

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function ProjectPage({
  projectId,
  view,
  overlay,
}: {
  projectId: string;
  view: ProjectView;
  overlay?: ReactNode;
}) {
  const project = okData(useGetProject(projectId).data);
  const format = useFormat();
  const overview = useGetProjectOverview(projectId).data?.data;
  const tasks = okData(useListReviewTasks(projectId).data) ?? [];
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useMockToast();
  const [bannerShut, setBannerShut] = useState(false);
  const failure = view.importFailed && !bannerShut ? overview?.import_failure : null;
  const goTab = (tab: ProjectTab) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab } });

  if (project === undefined) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-body-sm text-fg-dim">
        Loading the project…
      </main>
    );
  }

  const members =
    people.members.length > 0 ? project.members.map((member) => people.byId(member.user_id)) : [];
  return (
    <main
      data-testid="project-page"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--page) text-fg"
    >
      {failure ? (
        <Banner
          tone="bad"
          icon="x-circle"
          actions={
            <>
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/projects/$projectId/upload"
                    params={{ projectId }}
                    search={{ scene: "check" }}
                  />
                }
              >
                See the fix
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Dismiss. The message stays in the bell"
                title="Dismiss. The message stays in the bell"
                onClick={() => setBannerShut(true)}
              >
                <Icon name="close" />
              </Button>
            </>
          }
        >
          <b>{failure.file} was not imported.</b> All {failure.objects} objects fall outside slide{" "}
          {failure.slide_label}, {failure.reason}. Nothing was changed.
        </Banner>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col pt-5.5 pr-8 pb-4.5 pl-7">
        <header className="flex flex-none items-start justify-between gap-6 pt-0.5 pb-5.5">
          <div className="grid min-w-0 gap-2">
            <div className="flex min-w-0 items-center gap-3.5">
              <h2 className="m-0 truncate text-[24px] font-semibold tracking-[-0.015em]">
                {project.name}
              </h2>
              {privacyTag(project)}
              <AvatarStack people={members} max={4} size={26} />
            </div>
            <p className="m-0 flex flex-wrap text-body-sm text-fg-dim [&>span+span]:before:mx-2 [&>span+span]:before:text-fg-faint [&>span+span]:before:content-['·']">
              <span className="font-mono">{project.code}</span>
              {overview && overview.cases > 0 ? (
                <span>{plural(overview.cases, "case")}</span>
              ) : null}
              {overview ? <span>{plural(overview.slides, "slide")}</span> : null}
              {overview ? <span>{plural(overview.result_sets, "result set")}</span> : null}
              {overview ? <span>{format.integer(overview.objects)} objects with an ID</span> : null}
              {overview ? <span>{overview.reviewed_percent}% reviewed</span> : null}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/projects/$projectId/upload"
                  params={{ projectId }}
                  search={{ scene: "empty" }}
                />
              }
            >
              <Icon name="upload" />
              Upload
            </Button>
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/projects/$projectId/tasks/new" params={{ projectId }} />}
            >
              <Icon name="users" />
              New review task
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon" aria-label="More project actions" title="More">
                    <Icon name="more" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-65">
                <DropdownMenuItem
                  onClick={() =>
                    void navigate({ to: "/projects/$projectId/cases/new", params: { projectId } })
                  }
                >
                  <Icon name="folder" />
                  New case
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void navigate({ to: "/projects/$projectId/run-model", params: { projectId } })
                  }
                >
                  <Icon name="smart" />
                  Run a model
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void navigate({
                      to: "/projects/$projectId/upload",
                      params: { projectId },
                      search: { scene: "api" },
                    })
                  }
                >
                  <Icon name="link" />
                  Automatic imports
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    toast.show(
                      "Downloads decisions per object and every result set of the project (mock)",
                    )
                  }
                >
                  <Icon name="download" />
                  Export decisions and results
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => goTab("settings")}>
                  <Icon name="gear" />
                  Project settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Tabs value={view.tab} onValueChange={(value) => goTab(value as ProjectTab)}>
          <TabsList variant="page">
            <TabsTrigger value="slides">
              Slides
              {overview ? (
                <TabCount className="bg-transparent px-0 text-caption text-fg-faint">
                  {overview.slides}
                </TabCount>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="tasks">
              Review tasks
              <TabCount className="bg-transparent px-0 text-caption text-fg-faint">
                {tasks.length}
              </TabCount>
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </Tabs>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-3.5 pt-5",
            view.tab === "settings" ? "overflow-auto" : "overflow-hidden",
          )}
        >
          {view.tab === "slides" ? (
            <SlidesTab project={project} open={view.open} toast={toast.show} />
          ) : view.tab === "tasks" ? (
            <TasksTab project={project} tasks={tasks} toast={toast.show} />
          ) : (
            <SettingsTab project={project} addClass={view.addClass ?? false} toast={toast.show} />
          )}
        </div>
      </div>
      {overlay}
      {toast.node}
    </main>
  );
}
