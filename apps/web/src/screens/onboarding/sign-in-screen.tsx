import {
  type SignInLanding,
  useGetMe,
  useGetSessionPolicy,
  useListProjects,
  useListTenantMembers,
  useRequestProjectAccess,
} from "@parfocal/api-client";
import { LockCard, PasskeySheet } from "@parfocal/ui/components/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { defaultIdleLockMinutes } from "../../session/lock-rules.ts";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { NoAccessPage, SessionExpiredPage } from "../../shell/issue-pages.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { PitchLayout, slideImage } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { SignInScene } from "./scenes.ts";
import { EmailForm, type Flow } from "./sign-in-forms.tsx";

type Props = {
  scene: SignInScene;
  change: (scene: SignInScene) => void;
  returnTo: string | null;
};

const defaultSessionHours = 8;

export function SignInScreen({ scene, change, returnTo }: Props) {
  const me = okData(useGetMe().data);
  const policy = okData(useGetSessionPolicy().data);
  const goTo = useGoTo();
  const queryClient = useQueryClient();
  const [notice, show] = useNotice();
  const [signingInAgain, setSigningInAgain] = useState(false);
  const [typedEmail, setEmail] = useState<string | null>(null);
  const email = typedEmail ?? me?.email ?? "";
  const target = returnTo ?? destinations.home();
  const land = (session: SignInLanding) => {
    void queryClient.invalidateQueries();
    void goTo(session.return_to);
  };
  const landOnTarget = () => void goTo(target);
  const toast = (text: string) => show(text);
  const flow: Flow = { email, setEmail, returnTo, change, land };

  if (scene === "lock" || scene === "lockkey") {
    return (
      <div
        className="relative h-dvh overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${slideImage})` }}
      >
        <LockCard
          person={personOf(me)}
          minutes={policy?.idle_lock_minutes ?? defaultIdleLockMinutes}
          onUnlock={landOnTarget}
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
            onContinue={landOnTarget}
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
          onContinue={landOnTarget}
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
        hours={policy?.session_hours ?? defaultSessionHours}
        lastSaved="just now"
        onSignIn={() => setSigningInAgain(true)}
      />
    );
  }

  return (
    <PitchLayout>
      <EmailForm flow={flow} />
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
