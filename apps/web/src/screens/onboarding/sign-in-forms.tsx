import { Trans, useLingui } from "@lingui/react/macro";
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
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { CodeInput, handled, PasswordInput, problemText, useCountdown } from "./auth-inputs.tsx";
import type { SignInScene } from "./scenes.ts";
import {
  checkPassword,
  clock,
  codeLength,
  defaultResendSeconds,
  emailDomain,
  flagsOf,
  institutionFor,
  matchingInstitutions,
  organisationDomain,
  organisationSignInUrl,
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
  ssoUnknown: boolean;
};

function EmailField({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  return (
    <AuthField label={t`Work email`}>
      <Input
        aria-label={t`Work email`}
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
      <Trans>After you sign in:</Trans>{" "}
      {link.task_code ? (
        <>
          <b>{link.task_code}</b>,{" "}
        </>
      ) : null}
      <Trans>
        slide{" "}
        <b className="font-mono" data-phi="">
          {link.slide_label}
        </b>{" "}
        of{" "}
        <b className="font-mono" data-phi="">
          {link.case_label}
        </b>
      </Trans>
    </DeepLinkNote>
  );
}

export function EmailForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

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
        onSuccess: (response) => {
          if (response.status === 200) flow.land(response.data);
        },
        onError: (error) => setFailure(problemText(error, t`Could not sign in. Try again.`)),
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
        onError: (error) => setFailure(problemText(error, t`Single sign-on did not answer.`)),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Sign in to Parfocal`}>
        <Trans>{flow.workspace.name} workspace</Trans>
      </AuthHeading>
      <DeepLinkLine options={options} />
      {showsSso ? (
        <SsoButton
          workspace={{ name: matched.name, logo: matched.logo, colour: matched.colour }}
          onClick={continueWithSso}
          disabled={sso.isPending}
        >
          <Trans>Continue with {matched.short_name} single sign-on</Trans>
        </SsoButton>
      ) : null}
      {showsSso ? (
        <OrDivider>
          <Trans>or with your email</Trans>
        </OrDivider>
      ) : null}
      <EmailField flow={flow} />
      {methods?.password === false ? null : (
        <AuthField
          label={t`Password`}
          aside={
            <AuthLink onClick={() => flow.change("forgot")}>
              <Trans>Forgot password?</Trans>
            </AuthLink>
          }
        >
          <PasswordInput
            id="sign-in-password"
            label={t`Password`}
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
          <label htmlFor="keep-signed-in">
            <Trans>Keep me signed in on this computer</Trans>
          </label>
        </span>
      )}
      {methods?.password === false ? null : (
        <Button variant="primary" size="lg" block onClick={submit} disabled={signIn.isPending}>
          <Trans>Sign in</Trans>
        </Button>
      )}
      {methods?.sso !== false && matched === undefined ? (
        <Button size="lg" block onClick={() => flow.change("sso")}>
          <Icon name="shield" />
          <Trans>Sign in with your organisation</Trans>
        </Button>
      ) : null}
      {methods?.link === false ? null : (
        <Button size="lg" block onClick={() => flow.change("magic")}>
          <Icon name="mail" />
          <Trans>Email me a sign-in link instead</Trans>
        </Button>
      )}
      {methods?.passkey === false ? null : (
        <Button size="lg" block onClick={() => flow.change("passkey")}>
          <Icon name="key" />
          <Trans>Sign in with a passkey</Trans>
        </Button>
      )}
      <AuthFoot>
        <Trans>New to Parfocal?</Trans> <SignUpLink />
        <DotSeparator />
        <Trans>Invited? Open the link in your email</Trans>
      </AuthFoot>
    </AuthForm>
  );
}

function SignUpLink() {
  const goTo = useGoTo();
  return (
    <AuthLink onClick={() => void goTo("/sign-up")}>
      <Trans>Create an account</Trans>
    </AuthLink>
  );
}

export function MagicForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const { options, email } = flow;
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useCountdown(defaultResendSeconds);
  const send = useRequestSignInLink(handled);
  const signIn = useSignInWithCode(handled);
  const resend = () => {
    send.mutate(
      { data: { email } },
      {
        onSuccess: (response) => {
          setCode("");
          setFailure(null);
          setSecondsLeft(response.data.resend_seconds);
          flow.toast(t`Sends a new link. The old one stops working`);
        },
        onError: (error) => setFailure(problemText(error, t`Could not send the link.`)),
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
          setFailure(problemText(error, t`Could not check the code.`));
          setCode("");
        },
      },
    );
  };
  return (
    <AuthForm center>
      <AuthBadge icon="mail" />
      <AuthHeading title={t`Check your email`}>
        <Trans>
          We sent a sign-in link and a code to <b>{email}</b>. Both work once, for{" "}
          {options?.link_minutes ?? 15} minutes.
        </Trans>
      </AuthHeading>
      <CodeInput label={t`Sign-in code`} value={code} onChange={setCode} onSubmit={submit} />
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
        <Trans>Sign in with the code</Trans>
      </Button>
      <AuthFoot>
        <Trans>No email?</Trans>{" "}
        <AuthLink onClick={resend}>
          {secondsLeft > 0 ? t`Resend in ${clock(secondsLeft)}` : t`Resend the link`}
        </AuthLink>
        <DotSeparator />
        <AuthLink onClick={() => flow.change("email")}>
          <Trans>Use a password</Trans>
        </AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

export function SsoForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const institutions = flow.options?.institutions ?? [];
  const [text, setText] = useState(() => emailDomain(flow.email));
  const [picked, setPicked] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sso = useStartSso(handled);
  const listed = matchingInstitutions(text, institutions);
  const chosen =
    institutions.find((item) => item.workspace_id === picked) ??
    institutionFor(flow.email, institutions) ??
    listed[0];
  const domain = organisationDomain(text) ?? organisationDomain(flow.email);
  const go = () => {
    if (chosen === undefined) {
      if (domain !== null) window.location.assign(organisationSignInUrl(domain, flow.returnTo));
      return;
    }
    setFailure(null);
    sso.mutate(
      { data: { workspace_id: chosen.workspace_id, return_to: flow.returnTo } },
      {
        onSuccess: (response) => flow.land(response.data),
        onError: (error) => setFailure(problemText(error, t`Single sign-on did not answer.`)),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Continue with your institution`}>
        <Trans>Your institution checks who you are, so Parfocal never sees your password.</Trans>
      </AuthHeading>
      <AuthField label={t`Institution or email domain`}>
        <Input
          aria-label={t`Institution or email domain`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-9"
        />
      </AuthField>
      <div role="radiogroup" aria-label={t`Institutions`} className="grid gap-2">
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
                <StatusTag tone="ok">
                  <Trans>Matches your email</Trans>
                </StatusTag>
              ) : null
            }
          />
        ))}
      </div>
      {failure === null && !flow.ssoUnknown ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure ??
            t`No Parfocal workspace signs in that email domain through your organisation. Check the domain, or go back and sign in with your email.`}
        </Banner>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        onClick={go}
        disabled={(chosen === undefined && domain === null) || sso.isPending}
      >
        {chosen === undefined ? (
          <Trans>Continue to your organisation's sign-in</Trans>
        ) : (
          <Trans>Continue to {chosen.short_name} sign-in</Trans>
        )}
      </Button>
      <AuthFoot>
        <Trans>Not listed? Your admin can connect it in</Trans> <AdminSecurityLink />
        <DotSeparator />
        <AuthLink onClick={() => flow.change("email")}>
          <Trans>Back</Trans>
        </AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

function AdminSecurityLink() {
  const goTo = useGoTo();
  return (
    <AuthLink onClick={() => void goTo("/admin?scene=security")}>
      <Trans>Admin · Security</Trans>
    </AuthLink>
  );
}

export function ForgotForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const [failure, setFailure] = useState<string | null>(null);
  const reset = useRequestPasswordReset(handled);
  const send = () => {
    setFailure(null);
    reset.mutate(
      { data: { email: flow.email } },
      {
        onSuccess: (response) => {
          flow.toast(t`Reset link sent to ${response.data.email}`);
          flow.change("reset");
        },
        onError: (error) => setFailure(problemText(error, t`Could not send the link.`)),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Reset your password`}>
        <Trans>
          Enter your work email. If it has an account, a reset link arrives in a minute.
        </Trans>
      </AuthHeading>
      <EmailField flow={flow} />
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button variant="primary" size="lg" block onClick={send} disabled={reset.isPending}>
        <Trans>Send reset link</Trans>
      </Button>
      <Banner inline tone="info">
        <Trans>
          Signing in with {institutionFor(flow.email, flow.options?.institutions ?? [])?.short_name}{" "}
          single sign-on? Reset that password with hospital IT instead.
        </Trans>
      </Banner>
      <AuthFoot>
        <AuthLink onClick={() => flow.change("email")}>
          <Trans>Back to sign in</Trans>
        </AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

export function ResetForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [flags, setFlags] = useState<PasswordFlag[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const save = useResetPassword(handled);
  const check = checkPassword(password, flags);
  const submit = () => {
    if (password !== repeat) {
      setFailure(t`The two passwords are not the same.`);
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
              : problemText(error, t`Could not save the password.`),
          );
        },
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Choose a new password`}>
        <Trans>
          For <b>{flow.email}</b>. Other devices are signed out after the change.
        </Trans>
      </AuthHeading>
      <AuthField label={t`New password`}>
        <PasswordInput
          id="new-password"
          label={t`New password`}
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
      <AuthField label={t`Repeat it`}>
        <PasswordInput
          id="repeat-password"
          label={t`Repeat it`}
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
        <Trans>Save and sign in</Trans>
      </Button>
    </AuthForm>
  );
}

export const guidedLanding = (options: SignInOptions | undefined) => {
  const link = options?.deep_link ?? null;
  return link?.task_id ? destinations.guided(link.task_id, link.slide_id) : null;
};
