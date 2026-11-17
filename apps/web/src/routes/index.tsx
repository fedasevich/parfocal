import { createFileRoute } from "@tanstack/react-router";
import { HomeScreen } from "../screens/home/home-screen.tsx";
import { homeSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/")({
  validateSearch: homeSearch,
  component: HomeScreen,
});
