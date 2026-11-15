import { createFileRoute } from "@tanstack/react-router";
import { StudyScreen } from "../study/study-screen.tsx";

export const Route = createFileRoute("/study")({
  component: StudyScreen,
});
