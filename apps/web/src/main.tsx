import "@parfocal/ui/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";
import { createQueryClient } from "./query-client.ts";
import { createAppRouter } from "./router.ts";

const config = readBuildConfig();

export const clients = selectWebClients(config, {});

const queryClient = createQueryClient();

if (import.meta.env.DEV && config.fakeApi !== "off") {
  const { startFakeApi } = await import("./fake-api/start.tsx");
  await startFakeApi(config.fakeApi, queryClient);
}

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createAppRouter()} />
    </QueryClientProvider>
  </StrictMode>,
);
