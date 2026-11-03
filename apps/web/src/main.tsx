import "@parfocal/ui/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";
import { installDebugHandle } from "./debug-handle.ts";
import { createQueryClient } from "./query-client.ts";
import { createAppRouter } from "./router.ts";
import { ErrorToasts, showErrorToast } from "./shell/error-toasts.tsx";
import { UndoToasts } from "./shell/undo-toasts.tsx";

const config = readBuildConfig();

installDebugHandle(window, config.appEnv);

export const clients = selectWebClients(config, {});

const queryClient = createQueryClient(showErrorToast);

const prototypeFrame = import.meta.env.DEV
  ? (await import("./flow-map/prototype-bar.tsx")).PrototypeFrame
  : undefined;

const router = createAppRouter(prototypeFrame);

if (import.meta.env.DEV && config.fakeApi !== "off") {
  const { startFakeApi } = await import("./fake-api/start.tsx");
  await startFakeApi(config.fakeApi, queryClient, router);
}

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ErrorToasts />
      <UndoToasts />
    </QueryClientProvider>
  </StrictMode>,
);
