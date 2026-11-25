import { createFileRoute } from "@tanstack/react-router";
import { StudyJoin } from "../study/study-join.tsx";

export const Route = createFileRoute("/study/join")({
  component: StudyJoin,
});
