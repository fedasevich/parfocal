import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { DockCard, dockedCard } from "./inspector-slots.tsx";

export function NoClassesCard({
  projectId,
  section,
}: {
  projectId: string | undefined;
  section: "objects" | "display";
}) {
  if (projectId === undefined) return null;
  return (
    <DockCard section={section} order={-1}>
      <section className={dockedCard} data-testid="no-classes">
        <h3 className="font-medium text-fg">
          <Trans>This project has no classes</Trans>
        </h3>
        <p className="text-fg-dim">
          <Trans>
            Digits cannot set a type and cells read as no type until the project has classes.
          </Trans>
        </p>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: "settings", modal: "addcls" }}
          data-testid="no-classes-link"
          className="text-accent underline"
        >
          <Trans>Add classes in the project settings</Trans>
        </Link>
      </section>
    </DockCard>
  );
}
