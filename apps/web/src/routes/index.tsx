import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HomeScreen } from "../screens/home/home-screen.tsx";

const homeSearch = z.object({
  scene: z.enum(["launch", "new"]).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: homeSearch,
  component: HomeScreen,
});
