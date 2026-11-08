import { createRootRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { KeyBindingsProvider } from "../keys/keycap-bindings.tsx";
import { SessionLock } from "../session/session-lock.tsx";
import { CommandPalette } from "../shell/command-palette.tsx";
import { useAppliedDensity } from "../shell/density.ts";
import { GlobalShell } from "../shell/global-shell.tsx";
import { overlaySearch } from "../shell/overlays.ts";
import { SettingsKey } from "../shell/settings-key.tsx";
import { inGlobalShell } from "../shell/shell-routes.ts";
import { ShortcutsKey } from "../shell/shortcuts-key.tsx";

export const Route = createRootRoute({
  validateSearch: overlaySearch,
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  const inShell = useMatches({
    select: (matches) => matches.some(inGlobalShell),
  });
  useAppliedDensity();
  return (
    <SessionLock>
      <KeyBindingsProvider>
        {inShell ? (
          <GlobalShell>
            <Outlet />
          </GlobalShell>
        ) : (
          <Outlet />
        )}
        <CommandPalette />
        <ShortcutsKey />
        <SettingsKey />
      </KeyBindingsProvider>
    </SessionLock>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-2 p-8">
      <h1 className="font-semibold text-page-title text-fg">Page not found</h1>
      <Link to="/" className="text-accent underline">
        Go home
      </Link>
    </main>
  );
}
