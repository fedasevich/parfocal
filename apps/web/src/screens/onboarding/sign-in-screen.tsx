import {
  useGetMe,
  useListProjects,
  useListTenantMembers,
  useRequestProjectAccess,
} from "@parfocal/api-client";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  ChoiceOption,
  CodeBoxes,
  DeepLinkNote,
  DotSeparator,
  LockCard,
  OrDivider,
  PasskeySheet,
  PasswordMeter,
  RequirementList,
  SsoButton,
  WorkspaceLogo,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { PitchLayout, slideImage, useSignInOptions, workspaceOf } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { SignInScene } from "./scenes.ts";

type Props = { scene: SignInScene; change: (scene: SignInScene) => void };

function PasswordInput({ label, value, id }: { label: string; value: string; id: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative flex items-center">
      <Input
        id={id}
        aria-label={label}
        type={shown ? "text" : "password"}
        defaultValue={value}
        className="h-9 pr-9 font-mono"
      />
      <button
        type="button"
        aria-label={shown ? "Hide what you typed" : "Show what you typed"}
        onClick={() => setShown(!shown)}
        className="absolute right-2 cursor-pointer border-0 bg-transparent p-0 text-fg-faint"
      >
        <Icon name={shown ? "eye-off" : "eye"} />
      </button>
    </span>
  );
}

function KeepSignedIn() {
  return (
    <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
      <Checkbox id="keep-signed-in" defaultChecked />
      <label htmlFor="keep-signed-in">Keep me signed in on this computer</label>
    </span>
  );
}

export function SignInScreen({ scene, change }: Props) {
  const options = useSignInOptions();
  const me = okData(useGetMe().data);
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const workspace = workspaceOf(options);
  const email = me?.email ?? options?.email ?? "";
  const link = options?.deep_link ?? null;
  const signIn = () => {
    if (link === null) return void goTo(destinations.home());
    if (scene === "expired") {
      void goTo(destinations.guided(link.task_id, link.slide_id));
      return;
    }
    void goTo(destinations.slide(link.project_id, link.slide_id, link.task_id));
  };
  const toast = (text: string) => show(text);

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

  const emailForm = (
    <AuthForm>
      <AuthHeading title="Sign in to Parfocal">{workspace.name} workspace</AuthHeading>
      {scene === "expired" ? (
        <Banner inline tone="info" icon="clock">
          Your session ended after {options?.session_hours ?? 8} hours. Sign in to go on. Your last
          decision, {options?.last_decision ?? "your last one"}, is saved.
        </Banner>
      ) : link ? (
        <DeepLinkNote>
          After you sign in: <b>{link.task_code}</b>, slide{" "}
          <b className="font-mono">{link.slide_label}</b> of{" "}
          <b className="font-mono">{link.case_label}</b>
        </DeepLinkNote>
      ) : null}
      <SsoButton workspace={workspace} onClick={() => change("sso")}>
        Continue with Vltava single sign-on
      </SsoButton>
      <OrDivider>or with your email</OrDivider>
      <AuthField label="Work email">
        <Input
          key={email}
          aria-label="Work email"
          type="email"
          defaultValue={email}
          className="h-9"
        />
      </AuthField>
      <AuthField
        label="Password"
        aside={<AuthLink onClick={() => change("forgot")}>Forgot password?</AuthLink>}
      >
        <PasswordInput id="sign-in-password" label="Password" value="correct-horse" />
      </AuthField>
      <KeepSignedIn />
      <Button variant="primary" size="lg" block onClick={signIn}>
        Sign in
      </Button>
      <Button size="lg" block onClick={() => change("magic")}>
        <Icon name="mail" />
        Email me a sign-in link instead
      </Button>
      <Button size="lg" block onClick={() => change("passkey")}>
        <Icon name="key" />
        Sign in with a passkey
      </Button>
      <AuthFoot>
        New to Parfocal?{" "}
        <AuthLink onClick={() => void goTo("/sign-up")}>Create an account</AuthLink>
        <DotSeparator />
        Invited? Open the link in your email
      </AuthFoot>
    </AuthForm>
  );

  if (scene === "passkey" || scene === "passkeyqr") {
    return (
      <PitchLayout>
        {emailForm}
        <PasskeySheet
          kind={scene === "passkey" ? "touch" : "qr"}
          person={{ ...personOf(me), email }}
          onContinue={signIn}
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
    magic: (
      <AuthForm center>
        <AuthBadge icon="mail" />
        <AuthHeading title="Check your email">
          We sent a sign-in link and a code to <b>{email}</b>. Both work once, for{" "}
          {options?.link_minutes ?? 15} minutes.
        </AuthHeading>
        <CodeBoxes digits="481" aria-label="Sign-in code, 3 of 6 digits" />
        <Button variant="primary" size="lg" block onClick={signIn}>
          Sign in with the code
        </Button>
        <AuthFoot>
          No email?{" "}
          <AuthLink onClick={() => toast("Sends a new link. The old one stops working (mock)")}>
            Resend in 0:42
          </AuthLink>
          <DotSeparator />
          <AuthLink onClick={() => change("email")}>Use a password</AuthLink>
        </AuthFoot>
      </AuthForm>
    ),
    sso: (
      <AuthForm>
        <AuthHeading title="Continue with your institution">
          Your institution checks who you are, so Parfocal never sees your password.
        </AuthHeading>
        <AuthField label="Institution or email domain">
          <Input aria-label="Institution or email domain" defaultValue="vltava" className="h-9" />
        </AuthField>
        <div role="radiogroup" aria-label="Institutions" className="grid gap-2">
          {(options?.institutions ?? []).map((item) => (
            <ChoiceOption
              key={item.workspace_id}
              lead={
                <WorkspaceLogo
                  workspace={{ name: item.name, logo: item.logo, colour: item.colour }}
                />
              }
              title={item.name}
              detail={`${item.protocol} · ${item.domain}`}
              selected={item.matches_email}
              end={item.matches_email ? <StatusTag tone="ok">Matches your email</StatusTag> : null}
            />
          ))}
        </div>
        <Button variant="primary" size="lg" block onClick={signIn}>
          Continue to Vltava sign-in
        </Button>
        <AuthFoot>
          Not listed? Your admin can connect it in{" "}
          <AuthLink onClick={() => void goTo("/admin?scene=security")}>Admin · Security</AuthLink>
          <DotSeparator />
          <AuthLink onClick={() => change("email")}>Back</AuthLink>
        </AuthFoot>
      </AuthForm>
    ),
    forgot: (
      <AuthForm>
        <AuthHeading title="Reset your password">
          Enter your work email. If it has an account, a reset link arrives in a minute.
        </AuthHeading>
        <AuthField label="Work email">
          <Input
            key={email}
            aria-label="Work email"
            type="email"
            defaultValue={email}
            className="h-9"
          />
        </AuthField>
        <Button variant="primary" size="lg" block onClick={() => change("reset")}>
          Send reset link
        </Button>
        <Banner inline tone="info">
          Signing in with Vltava single sign-on? Reset that password with hospital IT instead.
        </Banner>
        <AuthFoot>
          <AuthLink onClick={() => change("email")}>Back to sign in</AuthLink>
        </AuthFoot>
      </AuthForm>
    ),
    reset: (
      <AuthForm>
        <AuthHeading title="Choose a new password">
          For <b>{email}</b>. Other devices are signed out after the change.
        </AuthHeading>
        <AuthField label="New password">
          <PasswordInput id="new-password" label="New password" value="new-horse-battery" />
        </AuthField>
        <PasswordMeter strength={3} label="Strong" />
        <RequirementList
          items={[
            { text: "At least 12 characters", met: true },
            { text: "Not one you used before", met: true },
            { text: "Not found in known leaks", met: true },
          ]}
        />
        <AuthField label="Repeat it">
          <PasswordInput id="repeat-password" label="Repeat it" value="new-horse-battery" />
        </AuthField>
        <Button variant="primary" size="lg" block onClick={signIn}>
          Save and sign in
        </Button>
      </AuthForm>
    ),
  };

  return (
    <PitchLayout>
      {scene === "email" || scene === "expired" ? emailForm : forms[scene]}
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
