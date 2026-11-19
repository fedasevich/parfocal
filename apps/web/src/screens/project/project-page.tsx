import { Trans, useLingui } from "@lingui/react/macro";
import {
  type Project,
  useGetProject,
  useGetProjectOverview,
  useListCases,
  useListMySlides,
  useListProjectResultSets,
  useListReviewTasks,
} from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { DropOverlay } from "@parfocal/ui/components/drop-overlay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack } from "@parfocal/ui/components/person";
import { SkeletonLine, SkeletonRows } from "@parfocal/ui/components/skeleton";
import { TabCount, Tabs, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useFormat } from "../../format.ts";
import { readDropped } from "../../upload/drop.ts";
import { dropStore } from "../../upload/drop-store.ts";
import { markTried } from "../home/getting-started.ts";
import { okData } from "../placeholder.tsx";
import { usePeople } from "./people.ts";
import { useScreenToast } from "./screen-toast.tsx";
import { SettingsTab } from "./settings-tab.tsx";
import { SlidesTab } from "./slides-tab.tsx";
import { TasksTab } from "./tasks-tab.tsx";

export type ProjectTab = "slides" | "tasks" | "settings";

export type ProjectView = {
  tab: ProjectTab;
  open?: string | undefined;
  importFailed?: boolean | undefined;
  addClass?: boolean | undefined;
  addPerson?: string | undefined;
};

const privacyTag = (project: Project) =>
  project.privacy_mode === "clinical" ? (
    <StatusTag tone="warn">
      <Trans>Clinical</Trans>
    </StatusTag>
  ) : (
    <StatusTag tone="accent">
      <Trans>De-identified</Trans>
    </StatusTag>
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
  const { t } = useLingui();

  const project = okData(useGetProject(projectId).data);
  const isSample = project?.sample === true;
  useEffect(() => {
    if (isSample) markTried("open-sample");
  }, [isSample]);
  const format = useFormat();
  const overview = okData(useGetProjectOverview(projectId).data);
  const tasksQuery = useListReviewTasks(projectId);
  const tasks = okData(tasksQuery.data) ?? [];
  const slidesFirst = { query: { enabled: view.tab === "slides" } };
  useListMySlides({ project_id: projectId }, slidesFirst);
  useListCases({ project_id: projectId }, slidesFirst);
  useListProjectResultSets(projectId, slidesFirst);
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useScreenToast();
  const [bannerShut, setBannerShut] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const failure = view.importFailed && !bannerShut ? overview?.import_failure : null;
  const goTab = (tab: ProjectTab) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab } });

  if (project === undefined) {
    return (
      <main className="grid flex-1 content-start gap-4 px-8 pt-5.5 pl-7">
        <div className="grid gap-2">
          <SkeletonLine width="20rem" className="text-page-title" />
          <SkeletonLine width="14rem" className="text-body-sm" />
        </div>
        <div className="rounded-zone border border-line bg-surf-panel">
          <SkeletonRows label={t`Loading the project`} rows={6} columns={4} />
        </div>
      </main>
    );
  }

  const members =
    people.members.length > 0 ? project.members.map((member) => people.byId(member.user_id)) : [];
  return (
    <main
      data-testid="project-page"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--page) text-fg"
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDragOver(false);
        void readDropped(event.dataTransfer).then((items) => {
          if (items.length === 0) return;
          dropStore.add(projectId, items);
          void navigate({
            to: "/projects/$projectId/upload",
            params: { projectId },
            search: { scene: "files", flow: "live" },
          });
        });
      }}
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
                <Trans>See the fix</Trans>
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t`Dismiss. The message stays in the bell`}
                title={t`Dismiss. The message stays in the bell`}
                onClick={() => setBannerShut(true)}
              >
                <Icon name="close" />
              </Button>
            </>
          }
        >
          <Trans>
            <b>{failure.file} was not imported.</b> All {failure.objects} objects fall outside slide{" "}
            {failure.slide_label}
          </Trans>
          , <Trans>{failure.reason}. Nothing was changed.</Trans>
        </Banner>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col pt-5.5 pr-8 pb-4.5 pl-7">
        <header className="flex flex-none flex-wrap items-start justify-between gap-x-6 gap-y-3 pt-0.5 pb-5.5">
          <div className="grid min-w-64 flex-1 basis-80 gap-2">
            <div className="flex min-w-0 items-center gap-3.5">
              <h2 className="m-0 truncate text-page-title font-semibold tracking-[-0.015em]">
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
              {overview ? (
                <span>
                  <Trans>{format.integer(overview.objects)} objects with an ID</Trans>
                </span>
              ) : null}
              {overview ? (
                <span>
                  <Trans>{overview.reviewed_percent}% reviewed</Trans>
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-none flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={<Link to="/projects/$projectId/upload" params={{ projectId }} />}
            >
              <Icon name="upload" />
              <Trans>Upload</Trans>
            </Button>
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/projects/$projectId/cases/new" params={{ projectId }} />}
            >
              <Icon name="folder" />
              <Trans>New case</Trans>
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/projects/$projectId/tasks/new" params={{ projectId }} />}
            >
              <Icon name="users" />
              <Trans>New review task</Trans>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon" aria-label={t`More project actions`} title={t`More`}>
                    <Icon name="more" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-65">
                <DropdownMenuItem
                  onClick={() =>
                    void navigate({ to: "/projects/$projectId/run-model", params: { projectId } })
                  }
                >
                  <Icon name="smart" />
                  <Trans>Run a model</Trans>
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
                  <Trans>Automatic imports</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => goTab("settings")}>
                  <Icon name="gear" />
                  <Trans>Project settings</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Tabs value={view.tab} onValueChange={(value) => goTab(value as ProjectTab)}>
          <TabsList variant="page">
            <TabsTrigger value="slides">
              <Trans>Slides</Trans>
              {overview ? <TabCount>{overview.slides}</TabCount> : null}
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <Trans>Review tasks</Trans>
              <TabCount>{tasks.length}</TabCount>
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Trans>Settings</Trans>
            </TabsTrigger>
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
            <TasksTab
              project={project}
              tasks={tasks}
              loading={tasksQuery.isPending}
              toast={toast.show}
            />
          ) : (
            <SettingsTab
              project={project}
              addClass={view.addClass ?? false}
              addPerson={view.addPerson}
              toast={toast.show}
            />
          )}
        </div>
      </div>
      {overlay}
      {dragOver ? (
        <DropOverlay
          projectCode={project.code}
          onDrop={() => void navigate({ to: "/projects/$projectId/upload", params: { projectId } })}
        />
      ) : null}
      {toast.node}
    </main>
  );
}
