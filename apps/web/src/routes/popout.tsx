import { createFileRoute } from "@tanstack/react-router";
import { PopoutScreen } from "../popout/popout-screen.tsx";

export const Route = createFileRoute("/popout")({
  component: PopoutScreen,
});
