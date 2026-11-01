import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  return <Outlet />;
}

function NotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-2 p-8">
      <h1 className="font-semibold text-2xl text-fg">Page not found</h1>
      <Link to="/" className="text-accent underline">
        Go home
      </Link>
    </main>
  );
}
