import { linkOptions } from "@tanstack/react-router";
import { mockScenes } from "../scenes.ts";

const projectNotes = {
  slides: "Slides grouped by case, with result sets and reviewers",
  results: "Slides with the result sets of A1 open",
  tasks: "The project's review tasks with each reviewer's progress",
  settings: "Privacy, review defaults, classes, opinion form and members",
  importfail: "Issue · a result file landed outside its slide and nothing was changed",
} as const;

const uploadNotes = {
  drop: "Files dragged over the project",
  empty: "1 Files · empty",
  files: "1 Files · dropped",
  link: "1 Files · from a link",
  remote: "1 Files · from storage",
  check: "2 Check · problems",
  allgood: "2 Check · all good",
  progress: "3 Upload · running",
  done: "3 Upload · done",
  tray: "Closed · in the jobs tray",
  viewer: "Viewer · add a result set",
  api: "Project settings · automatic imports",
  dup: "Issue · duplicate slide",
  storagefull: "Issue · storage full",
  unmatched: "Issue · unmatched result at Check",
  sourceoff: "Issue · source offline mid-upload",
} as const;

export function projectPrototypeLinks(projectId: string, clinicalProjectId: string | undefined) {
  return [
    ...mockScenes.project.map((scene) => ({
      key: `project-${scene}`,
      label: `Project · ${scene}`,
      note: projectNotes[scene],
      link: linkOptions({ to: "/projects/$projectId", params: { projectId }, search: { scene } }),
    })),
    {
      key: "project-addcls",
      label: "Project · Add a class",
      note: "The Add a class modal over Settings",
      link: linkOptions({
        to: "/projects/$projectId",
        params: { projectId },
        search: { tab: "settings", modal: "addcls" },
      }),
    },
    {
      key: "newcase-project",
      label: "New project",
      note: "The New project drawer over the project",
      link: linkOptions({ to: "/projects/new" }),
    },
    {
      key: "newcase-case",
      label: "New case · de-identified",
      note: "A case ID and specimen only, patient fields switched off",
      link: linkOptions({ to: "/projects/$projectId/cases/new", params: { projectId } }),
    },
    {
      key: "newcase-casec",
      label: "New case · clinical",
      note: "Patient fields shown and optional",
      link: linkOptions({
        to: "/projects/$projectId/cases/new",
        params: { projectId: clinicalProjectId ?? projectId },
      }),
    },
    ...mockScenes.upload.map((scene) => ({
      key: `upload-${scene}`,
      label: `Upload · ${scene}`,
      note: uploadNotes[scene],
      link: linkOptions({
        to: "/projects/$projectId/upload",
        params: { projectId },
        search: { scene },
      }),
    })),
    ...mockScenes.formats.map((formats) => ({
      key: `formats-${formats}`,
      label: `What files work · ${formats}`,
      note:
        formats === "help"
          ? "The help drawer over the upload"
          : "Checking a file without importing it",
      link: linkOptions({
        to: "/projects/$projectId/upload",
        params: { projectId },
        search: { scene: "files", formats },
      }),
    })),
  ];
}
