import {
  ApiError,
  type SignInOptions,
  type SignInSession,
  useRequestPasswordReset,
  useRequestSignInLink,
  useResetPassword,
  useSignInWithCode,
  useSignInWithPassword,
  useStartSso,
} from "@parfocal/api-client";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  type AuthWorkspace,
  ChoiceOption,
  CodeBoxes,
  DeepLinkNote,
  DotSeparator,
  OrDivider,
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
import { StatusTag } from "@parfocal/ui/components/tag";
import { type KeyboardEvent, useEffect, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import type { SignInScene } from "./scenes.ts";
import {
  checkPassword,
  clock,
  codeDigits,
  codeLength,
  defaultResendSeconds,
  flagsOf,
  institutionFor,
  matchingInstitutions,
  type PasswordFlag,
} from "./sign-in-rules.ts";

export type Flow = {
  options: SignInOptions | undefined;
  workspace: AuthWorkspace;
  email: string;
  setEmail: (email: string) => void;
  returnTo: string | null;
  scene: SignInScene;
  change: (scene: SignInScene) => void;
  land: (session: SignInSession) => void;
  toast: (text: string) => void;
};

const handled = { mutation: { onError: () => undefined } };

const onEnter = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  action();
};

const problemText = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.problem?.title ? error.problem.title : fallback;

function PasswordInput({
  label,
  id,
  value,
  onChange,
  onSubmit,
  fresh = false,
}: {
  fresh?: boolean;
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative flex items-center">
      <Input
        id={id}
        aria-label={label}
        type={shown ? "text" : "password"}
        value={value}
        autoComplete={`${fresh ? "new" : "current"}-password`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onSubmit ? onEnter(onSubmit) : undefined}
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

function EmailField({ flow }: { flow: Flow }) {
  return (
    <AuthField label="Work email">
      <Input
        aria-label="Work email"
        type="email"
        autoComplete="username"
        value={flow.email}
        onChange={(event) => flow.setEmail(event.target.value)}
        className="h-9"
      />
    </AuthField>
  );
}

function DeepLinkLine({ options }: { options: SignInOptions | undefined }) {
  const link = options?.deep_link ?? null;
  if (link === null) return null;
  return (
    <DeepLinkNote>
      After you sign in:{" "}
      {link.task_code ? (
        <>
          <b>{link.task_code}</b>,{" "}
        </>
      ) : null}
      slide <b className="font-mono">{link.slide_label}</b> of{" "}
      <b className="font-mono">{link.case_label}</b>
    </DeepLinkNote>
  );
}

export function EmailForm({ flow }: { flow: Flow }) {
  const { options, email } = flow;
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const signIn = useSignInWithPassword(handled);
  const sso = useStartSso(handled);
  const methods = options?.methods;
  const matched = institutionFor(email, options?.institutions ?? []);
  const showsSso = methods?.sso !== false && matched !== undefined;
  const submit = () => {
    setFailure(null);
    signIn.mutate(
      { data: { email, password, keep_signed_in: keep, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => setFailure(problemText(error, "Could not sign in. Try again.")),
      },
    );
  };
  const continueWithSso = () => {
    if (matched === undefined) return;
    setFailure(null);
    sso.mutate(
      { data: { workspace_id: matched.workspace_id, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => setFailure(problemText(error, "Single sign-on did not answer.")),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title="Sign in to Parfocal">{flow.workspace.name} workspace</AuthHeading>
      {flow.scene === "expired" ? (
        <Banner inline tone="info" icon="clock">
          Your session ended after {options?.session_hours ?? 8} hours. Sign in to go on. Your last
          decision, {options?.last_decision ?? "your last one"}, is saved.
        </Banner>
      ) : (
        <DeepLinkLine options={options} />
      )}
      {showsSso ? (
        <SsoButton
          workspace={{ name: matched.name, logo: matched.logo, colour: matched.colour }}
          onClick={continueWithSso}
          disabled={sso.isPending}
        >
          Continue with {matched.short_name} single sign-on
        </SsoButton>
      ) : null}
      {showsSso ? <OrDivider>or with your email</OrDivider> : null}
      <EmailField flow={flow} />
      {methods?.password === false ? null : (
        <AuthField
          label="Password"
          aside={<AuthLink onClick={() => flow.change("forgot")}>Forgot password?</AuthLink>}
        >
          <PasswordInput
            id="sign-in-password"
            label="Password"
            value={password}
            onChange={setPassword}
            onSubmit={submit}
          />
        </AuthField>
      )}
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      {methods?.password === false ? null : (
        <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
          <Checkbox
            id="keep-signed-in"
            checked={keep}
            onCheckedChange={(checked) => setKeep(checked === true)}
          />
          <label htmlFor="keep-signed-in">Keep me signed in on this computer</label>
        </span>
      )}
      {methods?.password === false ? null : (
        <Button variant="primary" size="lg" block onClick={submit} disabled={signIn.isPending}>
          Sign in
        </Button>
      )}
      {methods?.sso !== false && matched === undefined ? (
        <Button size="lg" block onClick={() => flow.change("sso")}>
          <Icon name="shield" />
          Use single sign-on instead
        </Button>
      ) : null}
      {methods?.link === false ? null : (
        <Button size="lg" block onClick={() => flow.change("magic")}>
          <Icon name="mail" />
          Email me a sign-in link instead
        </Button>
      )}
      {methods?.passkey === false ? null : (
        <Button size="lg" block onClick={() => flow.change("passkey")}>
          <Icon name="key" />
          Sign in with a passkey
        </Button>
      )}
      <AuthFoot>
        New to Parfocal? <SignUpLink />
        <DotSeparator />
        Invited? Open the link in your email
      </AuthFoot>
    </AuthForm>
  );
}

function SignUpLink() {
  const goTo = useGoTo();
  return <AuthLink onClick={() => void goTo("/sign-up")}>Create an account</AuthLink>;
}

export function MagicForm({ flow }: { flow: Flow }) {
  const { options, email } = flow;
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(defaultResendSeconds);
  const send = useRequestSignInLink(handled);
  const signIn = useSignInWithCode(handled);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  const resend = () => {
    send.mutate(
      { data: { email } },
      {
        onSuccess: (response) => {
          setCode("");
          setFailure(null);
          setSecondsLeft(response.data.resend_seconds);
          flow.toast("Sends a new link. The old one stops working");
        },
        onError: (error) => setFailure(problemText(error, "Could not send the link.")),
      },
    );
  };
  const submit = () => {
    setFailure(null);
    signIn.mutate(
      { data: { email, code, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => {
          setFailure(problemText(error, "Could not check the code."));
          setCode("");
        },
      },
    );
  };
  return (
    <AuthForm center>
      <AuthBadge icon="mail" />
      <AuthHeading title="Check your email">
        We sent a sign-in link and a code to <b>{email}</b>. Both work once, for{" "}
        {options?.link_minutes ?? 15} minutes.
      </AuthHeading>
      <div className="relative">
        <CodeBoxes digits={code} aria-hidden="true" />
        <input
          aria-label="Sign-in code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={codeLength}
          value={code}
          onChange={(event) => setCode(codeDigits(event.target.value))}
          onKeyDown={onEnter(() => code.length === codeLength && submit())}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      </div>
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        onClick={submit}
        disabled={code.length < codeLength || signIn.isPending}
      >
        Sign in with the code
      </Button>
      <AuthFoot>
        No email?{" "}
        <AuthLink onClick={resend}>
          {secondsLeft > 0 ? `Resend in ${clock(secondsLeft)}` : "Resend the link"}
        </AuthLink>
        <DotSeparator />
        <AuthLink onClick={() => flow.change("email")}>Use a password</AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

export function SsoForm({ flow }: { flow: Flow }) {
  const institutions = flow.options?.institutions ?? [];
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sso = useStartSso(handled);
  const listed = matchingInstitutions(text, institutions);
  const chosen =
    institutions.find((item) => item.workspace_id === picked) ??
    institutionFor(flow.email, institutions) ??
    listed[0];
  const go = () => {
    if (chosen === undefined) return;
    setFailure(null);
    sso.mutate(
      { data: { workspace_id: chosen.workspace_id, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => setFailure(problemText(error, "Single sign-on did not answer.")),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title="Continue with your institution">
        Your institution checks who you are, so Parfocal never sees your password.
      </AuthHeading>
      <AuthField label="Institution or email domain">
        <Input
          aria-label="Institution or email domain"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-9"
        />
      </AuthField>
      <div role="radiogroup" aria-label="Institutions" className="grid gap-2">
        {listed.map((item) => (
          <ChoiceOption
            key={item.workspace_id}
            lead={
              <WorkspaceLogo
                workspace={{ name: item.name, logo: item.logo, colour: item.colour }}
              />
            }
            title={item.name}
            detail={`${item.protocol} · ${item.domain}`}
            selected={item.workspace_id === chosen?.workspace_id}
            onClick={() => setPicked(item.workspace_id)}
            end={
              institutionFor(flow.email, [item]) ? (
                <StatusTag tone="ok">Matches your email</StatusTag>
              ) : null
            }
          />
        ))}
      </div>
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        onClick={go}
        disabled={chosen === undefined || sso.isPending}
      >
        Continue to {chosen?.short_name ?? "your institution"} sign-in
      </Button>
      <AuthFoot>
        Not listed? Your admin can connect it in <AdminSecurityLink />
        <DotSeparator />
        <AuthLink onClick={() => flow.change("email")}>Back</AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

function AdminSecurityLink() {
  const goTo = useGoTo();
  return <AuthLink onClick={() => void goTo("/admin?scene=security")}>Admin · Security</AuthLink>;
}

export function ForgotForm({ flow }: { flow: Flow }) {
  const [failure, setFailure] = useState<string | null>(null);
  const reset = useRequestPasswordReset(handled);
  const send = () => {
    setFailure(null);
    reset.mutate(
      { data: { email: flow.email } },
      {
        onSuccess: (response) => {
          flow.toast(`Reset link sent to ${response.data.email}`);
          flow.change("reset");
        },
        onError: (error) => setFailure(problemText(error, "Could not send the link.")),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title="Reset your password">
        Enter your work email. If it has an account, a reset link arrives in a minute.
      </AuthHeading>
      <EmailField flow={flow} />
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button variant="primary" size="lg" block onClick={send} disabled={reset.isPending}>
        Send reset link
      </Button>
      <Banner inline tone="info">
        Signing in with {institutionFor(flow.email, flow.options?.institutions ?? [])?.short_name}{" "}
        single sign-on? Reset that password with hospital IT instead.
      </Banner>
      <AuthFoot>
        <AuthLink onClick={() => flow.change("email")}>Back to sign in</AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

export function ResetForm({ flow }: { flow: Flow }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [flags, setFlags] = useState<PasswordFlag[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const save = useResetPassword(handled);
  const check = checkPassword(password, flags);
  const submit = () => {
    if (password !== repeat) {
      setFailure("The two passwords are not the same.");
      return;
    }
    setFailure(null);
    save.mutate(
      { data: { email: flow.email, password, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => {
          setFlags(error instanceof ApiError ? flagsOf(error.fieldErrors()) : []);
          setFailure(
            error instanceof ApiError && error.fieldErrors().length > 0
              ? error
                  .fieldErrors()
                  .map((item) => item.message)
                  .join(". ")
              : problemText(error, "Could not save the password."),
          );
        },
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title="Choose a new password">
        For <b>{flow.email}</b>. Other devices are signed out after the change.
      </AuthHeading>
      <AuthField label="New password">
        <PasswordInput
          id="new-password"
          label="New password"
          fresh
          value={password}
          onChange={(value) => {
            setPassword(value);
            setFlags([]);
          }}
        />
      </AuthField>
      <PasswordMeter strength={check.strength} label={check.label} />
      <RequirementList items={check.requirements} />
      <AuthField label="Repeat it">
        <PasswordInput
          id="repeat-password"
          label="Repeat it"
          fresh
          value={repeat}
          onChange={setRepeat}
          onSubmit={submit}
        />
      </AuthField>
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button variant="primary" size="lg" block onClick={submit} disabled={save.isPending}>
        Save and sign in
      </Button>
    </AuthForm>
  );
}

export const guidedLanding = (options: SignInOptions | undefined) => {
  const link = options?.deep_link ?? null;
  return link?.task_id ? destinations.guided(link.task_id, link.slide_id) : null;
};
