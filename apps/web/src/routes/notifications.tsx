import { createFileRoute } from "@tanstack/react-router";
import {
  defaultPageSize,
  NotificationsScreen,
} from "../screens/notifications/notifications-screen.tsx";
import { notificationsSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/notifications")({
  validateSearch: notificationsSearch,
  component: Notifications,
});

function Notifications() {
  const search = Route.useSearch();
  return <NotificationsScreen size={search.size ?? defaultPageSize} />;
}
