import {
  type SignInSession,
  useGetMe,
  useListProjects,
  useListTenantMembers,
  useRequestProjectAccess,
} from "@parfocal/api-client";
import {
  AuthFoot,
  AuthForm,
  AuthHeading,
  LockCard,
  PasskeySheet,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { toPersonInfo } from "../people.ts";
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
  const me = okData(useGetMe().data);
  const projects = okData(useListProjects().data) ?? [];
  const members = okData(useListTenantMembers().data) ?? [];
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const ask = useRequestProjectAccess();
  const [asked, setAsked] = useState(false);
  const project = projects.find((item) => item.code === "P03");
  const ownerId = project?.members.find((member) => member.role === "owner")?.user_id;
  const owner = members.find((member) => member.user_id === ownerId);
  const ownerName = owner?.display_name ?? "the owner";
  const ownerFirst = ownerName.split(" ")[0];
  return (
    <PitchLayout>
      <AuthForm>
        <AuthHeading title={`No access to ${project?.name ?? "this project"}`}>
          Signed in as <b>{me?.email}</b>
        </AuthHeading>
        <Banner inline tone="warn" icon="lock">
          You are not a member of {project?.name}. Ask {ownerName}, its owner, to add you.
        </Banner>
        {owner ? (
          <div className="text-left">
            <Person
              person={toPersonInfo(owner)}
              size={24}
              sub={`Owner of ${project?.name ?? "the project"}`}
            />
          </div>
        ) : null}
        {asked ? (
          <Button
            variant="primary"
            size="lg"
            block
            disabled
            title={`${ownerName} has your request`}
          >
            <Icon name="check" />
            Asked, 11:02
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
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
          >
            Ask for access
          </Button>
        )}
        <Button size="lg" block onClick={() => void goTo(destinations.myWork())}>
          Go to My work
        </Button>
        <AuthFoot>{ownerFirst} gets your request in the bell and by email.</AuthFoot>
      </AuthForm>
      {notice}
    </PitchLayout>
  );
}
