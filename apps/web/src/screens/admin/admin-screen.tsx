import { type StudyTemplateSummary, useGetMe, useListStudyTemplates } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Breadcrumbs } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo, useRouterLink } from "../../shell/router-link.tsx";
import { useNotice } from "../onboarding/notice.tsx";
import {
  type AdminModal,
  type AdminScene,
  type AdminSection,
  isConnectModelScene,
} from "../onboarding/scenes.ts";
import { okData } from "../placeholder.tsx";
import { type AdminAccess, adminAccessOf, refusalOf } from "./admin-access.ts";
import { AdminShell, adminHref, adminSectionList } from "./admin-shell.tsx";
import { AuditExportButton, AuditSection } from "./audit.tsx";
import { type AuditFilter, defaultAuditFilter } from "./audit-model.ts";
import { ConnectModelScreen } from "./connect-model.tsx";
import { OverviewSection } from "./overview.tsx";
import { PeopleSection } from "./people.tsx";
import { ApiSection, ModelsSection, ProjectsSection, SecuritySection } from "./sections.tsx";
import { StorageSection } from "./storage.tsx";
import { TemplateEditor } from "./template-editor.tsx";
import { editorHead, type TemplateSource } from "./template-model.ts";
import { TemplatesSection } from "./templates.tsx";
import { WorkspaceSettingsSection } from "./workspace-settings.tsx";

type Props = {
  section: AdminSection;
  scene: AdminScene | undefined;
  modal: AdminModal | undefined;
  request?: string | undefined;
  change: (next: {
    section?: AdminSection;
    scene?: AdminScene | undefined;
    modal?: AdminModal | undefined;
  }) => void;
};

export function AdminScreen({ section, scene, modal, request, change }: Props) {
  const me = okData(useGetMe().data);
  const templates = okData(useListStudyTemplates().data) ?? [];
  const renderLink = useRouterLink();
  const goTo = useGoTo();
  const [notice, notify] = useNotice();
  const [source, setSource] = useState<TemplateSource | null>(null);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>(defaultAuditFilter);
  const workspaceName =
    me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.name ?? "The workspace";
  const open = (next: AdminSection) =>
    change({ section: next, scene: undefined, modal: undefined });

  if (me === undefined) {
    return (
      <AdminShell section={section} folded>
        <p className="p-8 text-body-sm text-fg-dim">Checking your access…</p>
      </AdminShell>
    );
  }
  const access = adminAccessOf(me);
  if (access !== "granted") {
    return (
      <AdminShell section={section} folded>
        <AdminRefusal access={access} />
      </AdminShell>
    );
  }

  if (isConnectModelScene(scene)) {
    return (
      <AdminShell section="models" folded>
        <ConnectModelScreen
          scene={scene}
          onScene={(next) => change({ section: "models", scene: next, modal: undefined })}
          contract={modal === "contract"}
          onContract={(open) => change({ modal: open ? "contract" : undefined })}
          onDone={() => change({ section: "models", scene: undefined, modal: undefined })}
          notify={notify}
        />
        {notice}
      </AdminShell>
    );
  }

  if (scene === "tpledit") {
    const head = editorHead(
      source ?? templates.find((item) => item.built_in === null) ?? templates[0],
    );
    return (
      <AdminShell section="templates" folded>
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-surf-panel">
          <header className="grid gap-1 border-b border-line px-6 pt-4 pb-3">
            <Breadcrumbs
              items={[
                { label: "Admin", href: adminHref("overview") },
                { label: "Report templates", href: adminHref("templates") },
                { label: head.title },
              ]}
              renderLink={renderLink}
            />
            <h1 className="m-0 text-title-sm font-semibold text-fg">{head.title}</h1>
            <p className="m-0 text-body-sm text-fg-dim">{head.sub}</p>
          </header>
          <TemplateEditor
            key={source ? ("id" in source ? source.id : source.name) : "default"}
            source={source}
            notify={notify}
            onBack={() => {
              setSource(null);
              change({ section: "templates", scene: undefined });
            }}
          />
        </div>
        {notice}
      </AdminShell>
    );
  }

  const info = adminSectionList.find((item) => item.key === section) ?? adminSectionList[0];
  const actions: Partial<Record<AdminSection, React.ReactNode>> = {
    people: (
      <Button variant="primary" onClick={() => change({ modal: "invite" })}>
        <Icon name="mail" />
        Invite people
      </Button>
    ),
    projects: (
      <Button onClick={() => void goTo(destinations.newProject())}>
        <Icon name="folder" />
        New project
      </Button>
    ),
    models: (
      <Button variant="primary" onClick={() => change({ scene: "addmodel" })}>
        <Icon name="plus" />
        Connect your own model
      </Button>
    ),
    templates: (
      <Button variant="primary" onClick={() => change({ scene: "tplnew" })}>
        <Icon name="plus" />
        New template
      </Button>
    ),
    storage: (
      <Button
        variant="primary"
        onClick={() =>
          notify(
            "Connect a source: S3, Azure, DICOMweb or HTTPS with range requests. Read-only keys only (mock)",
          )
        }
      >
        <Icon name="link" />
        Connect a source
      </Button>
    ),
    audit: <AuditExportButton filter={auditFilter} notify={notify} />,
  };
  const body: Record<AdminSection, React.ReactNode> = {
    overview: <OverviewSection open={open} />,
    people: (
      <PeopleSection
        notify={notify}
        request={request}
        inviting={modal === "invite"}
        setInviting={(on) => change({ modal: on ? "invite" : undefined })}
      />
    ),
    projects: <ProjectsSection notify={notify} />,
    models: <ModelsSection notify={notify} />,
    templates: (
      <TemplatesSection
        notify={notify}
        creating={scene === "tplnew"}
        setCreating={(on) => change({ scene: on ? "tplnew" : undefined })}
        onOpen={(next) => {
          setSource(next);
          change({ section: "templates", scene: "tpledit" });
        }}
      />
    ),
    storage: <StorageSection notify={notify} />,
    api: <ApiSection notify={notify} />,
    audit: <AuditSection filter={auditFilter} onFilter={setAuditFilter} />,
    security: <SecuritySection notify={notify} />,
    settings: <WorkspaceSettingsSection notify={notify} workspaceName={workspaceName} />,
  };
  return (
    <AdminShell section={section}>
      <main className="flex min-h-full flex-col gap-(--space-zone) bg-surf-panel px-(--pad-modal) pb-(--pad-modal)">
        <header className="sticky top-0 z-2 flex items-center justify-between gap-4 bg-surf-panel pt-5 pb-1">
          <div>
            <h1 className="m-0 text-title-sm font-semibold text-fg">{info?.label}</h1>
            <p className="mt-0.75 mb-0 text-body-sm text-fg-dim">
              {section === "overview" ? `${workspaceName} at a glance` : info?.sub}
            </p>
          </div>
          {actions[section] ? <div className="flex flex-none gap-2">{actions[section]}</div> : null}
        </header>
        {body[section]}
      </main>
      {notice}
    </AdminShell>
  );
}

export function AdminRefusal({ access }: { access: Exclude<AdminAccess, "granted"> }) {
  const renderLink = useRouterLink();
  const refusal = refusalOf(access);
  return (
    <main
      aria-labelledby="admin-refusal-title"
      className="mx-auto flex max-w-xl flex-col gap-3 px-(--pad-modal) py-16"
    >
      <h1 id="admin-refusal-title" className="m-0 text-title-sm font-semibold text-fg">
        {refusal.title}
      </h1>
      <p role="alert" className="m-0 text-body text-fg-dim">
        {refusal.body}
      </p>
      <div>
        {renderLink({
          href: destinations.home(),
          className: "text-body-sm font-medium text-accent hover:underline",
          children: "Back to Parfocal",
        })}
      </div>
    </main>
  );
}
