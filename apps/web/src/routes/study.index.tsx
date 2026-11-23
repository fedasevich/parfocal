import { createFileRoute } from "@tanstack/react-router";
import { ParticipantScreen } from "../study/participant-screen.tsx";

export const Route = createFileRoute("/study/")({
  component: ParticipantScreen,
});
