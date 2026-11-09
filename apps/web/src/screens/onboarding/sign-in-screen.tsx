import {
  type SignInSession,
  useGetMe,
  useListProjects,
  useListTenantMembers,
  useRequestProjectAccess,
} from "@parfocal/api-client";
import { LockCard, PasskeySheet } from "@parfocal/ui/components/auth";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { NoAccessPage, SessionExpiredPage } from "../../shell/issue-pages.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { PitchLayout, slideImage, useSignInOptions, workspaceOf } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { SignInScene } from "./scenes.ts";
import {
  EmailForm,
  type Flow,
  ForgotForm,
  MagicForm,
  ResetForm,
  SsoForm,
} from "./sign-in-forms.tsx";

type Props = {
  scene: SignInScene;
  change: (scene: SignInScene) => void;
  returnTo: string | null;
};

export function SignInScreen({ scene, change, returnTo }: Props) {
  const options = useSignInOptions(returnTo);
  const me = okData(useGetMe().data);
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const workspace = workspaceOf(options);
  const [signingInAgain, setSigningInAgain] = useState(false);
  const [typedEmail, setEmail] = useState<string | null>(null);
  const email = typedEmail ?? me?.email ?? options?.email ?? "";
  const link = options?.deep_link ?? null;
  const land = (session: SignInSession) => {
    if (scene === "expired" && link?.task_id) {
      void goTo(destinations.guided(link.task_id, link.slide_id));
      return;
    }
    void goTo(session.return_to);
  };
  const landOnLink = () => void goTo(link?.path ?? destinations.home());
  const toast = (text: string) => show(text);
  const flow: Flow = { options, workspace, email, setEmail, returnTo, scene, change, land, toast };

  if (scene === "lock" || scene === "lockkey") {
    return (
      <div
        className="relative h-dvh overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${slideImage})` }}
      >
        <LockCard
          person={personOf(me)}
          minutes={options?.idle_lock_minutes ?? 15}
          onUnlock={() => link && void goTo(destinations.slide(link.project_id, link.slide_id))}
          onPasskey={() => change("lockkey")}
          onLogOut={() =>
            toast(
              `Logs ${me?.display_name ?? "you"} out. Decisions, comments and the view are already saved (mock)`,
            )
          }
        />
        {scene === "lockkey" ? (
          <PasskeySheet
            kind="touch"
            person={{ ...personOf(me), email }}
            onContinue={() => link && void goTo(destinations.slide(link.project_id, link.slide_id))}
            onCancel={() => change("lock")}
            onOther={() =>
              toast(
                "Shows a QR code for the phone with your passkey, or waits for a security key, as on the sign-in page (mock)",
              )
            }
          />
        ) : null}
        {notice}
      </div>
    );
  }

  if (scene === "passkey" || scene === "passkeyqr") {
    return (
      <PitchLayout>
        <EmailForm flow={flow} />
        <PasskeySheet
          kind={scene === "passkey" ? "touch" : "qr"}
          person={{ ...personOf(me), email }}
          onContinue={landOnLink}
          onCancel={() => change("email")}
          onOther={() => change("passkeyqr")}
          onBack={() => change("passkey")}
          className="left-[calc(280px+50%)]"
        />
      </PitchLayout>
    );
  }

  if (scene === "noaccess") return <NoAccess />;

  if (scene === "expired" && !signingInAgain) {
    return (
      <SessionExpiredPage
        hours={options?.session_hours ?? 8}
        lastSaved={options?.last_decision ?? "just now"}
        onSignIn={() => setSigningInAgain(true)}
      />
    );
  }

  const forms: Record<"magic" | "sso" | "forgot" | "reset", React.ReactNode> = {
    magic: <MagicForm flow={flow} />,
    sso: <SsoForm flow={flow} />,
    forgot: <ForgotForm flow={flow} />,
    reset: <ResetForm flow={flow} />,
  };

  return (
    <PitchLayout>
      {scene === "email" || scene === "expired" ? <EmailForm flow={flow} /> : forms[scene]}
      {notice}
    </PitchLayout>
  );
}

function NoAccess() {
  const projects = okData(useListProjects().data) ?? [];
  const members = okData(useListTenantMembers().data) ?? [];
  const [notice, show] = useNotice();
  const ask = useRequestProjectAccess();
  const [asked, setAsked] = useState(false);
  const project = projects.find((item) => item.code === "P03");
  const ownerId = project?.members.find((member) => member.role === "owner")?.user_id;
  const ownerName =
    members.find((member) => member.user_id === ownerId)?.display_name ?? "the owner";
  return (
    <>
      <NoAccessPage
        projectName={project?.name ?? "this project"}
        ownerName={ownerName}
        asked={asked}
        onAsk={() => {
          if (project === undefined) return;
          ask.mutate(
            { projectId: project.id },
            {
              onSuccess: () => {
                setAsked(true);
                show(`Asked ${ownerName} to add you to ${project.name}`);
              },
            },
          );
        }}
      />
      {notice}
    </>
  );
}
