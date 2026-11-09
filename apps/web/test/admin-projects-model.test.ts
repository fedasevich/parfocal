import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "@parfocal/api-client";
import {
  archiveActionLabel,
  archiveDoneNotice,
  archiveRefusalNotice,
  canChangeArchive,
  projectStatusLabel,
  projectsCountLabel,
} from "../src/screens/admin/projects-model.ts";

const project = (archivedAt: string | null, role: Project["my_role"]) =>
  ({ name: "Lung atlas", archived_at: archivedAt, my_role: role }) as Project;

test("an archived project reads as archived and offers to unarchive", () => {
  const archived = project("2026-11-01T00:00:00Z", "owner");
  assert.equal(projectStatusLabel(archived), "Archived");
  assert.equal(archiveActionLabel(archived), "Unarchive");
  assert.match(archiveDoneNotice(archived), /active again/);
});

test("an active project offers to archive", () => {
  const active = project(null, "owner");
  assert.equal(projectStatusLabel(active), "Active");
  assert.equal(archiveActionLabel(active), "Archive");
  assert.match(archiveDoneNotice(active), /stays readable/);
});

test("only owners change the archive state", () => {
  assert.equal(canChangeArchive(project(null, "owner")), true);
  assert.equal(canChangeArchive(project(null, "reviewer")), false);
  assert.equal(canChangeArchive(project(null, null)), false);
  assert.match(archiveRefusalNotice(project(null, "viewer")), /Only a project owner/);
  assert.match(archiveRefusalNotice(project(null, "owner")), /Try again/);
});

test("the count names the view", () => {
  assert.equal(projectsCountLabel(1, "archived"), "1 archived project");
  assert.equal(projectsCountLabel(3, "active"), "3 active projects");
});
