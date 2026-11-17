import { Trans, useLingui } from "@lingui/react/macro";
import { ApiError, useRequestPasswordReset, useResetPassword } from "@parfocal/api-client";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  DotSeparator,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Input } from "@parfocal/ui/components/input";
import { useState } from "react";
import { CodeInput, handled, PasswordInput, problemText, useCountdown } from "./auth-inputs.tsx";
import type { Flow } from "./sign-in-forms.tsx";
import { clock, codeDigits, codeLength } from "./sign-in-rules.ts";

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.fieldErrors().length > 0
    ? error
        .fieldErrors()
        .map((item) => item.message)
        .join(". ")
    : problemText(error, fallback);

export function ForgotPasswordForm({
  flow,
  sent,
}: {
  flow: Flow;
  sent: (resendSeconds: number) => void;
}) {
  const { t } = useLingui();
  const [failure, setFailure] = useState<string | null>(null);
  const request = useRequestPasswordReset(handled);
  const submit = () => {
    setFailure(null);
    if (flow.email.trim() === "") {
      setFailure(t`Enter your work email, then ask for a code.`);
      return;
    }
    request.mutate(
      { data: { email: flow.email.trim() } },
      {
        onSuccess: (response) => {
          if (response.status === 200) sent(response.data.resend_seconds);
        },
        onError: (error) => setFailure(problemText(error, t`Could not send the code.`)),
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Reset your password`}>
        <Trans>We email a {codeLength}-digit code to the address on your account.</Trans>
      </AuthHeading>
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
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button variant="primary" size="lg" block onClick={submit} disabled={request.isPending}>
        <Trans>Email me a code</Trans>
      </Button>
      <AuthFoot>
        <AuthLink onClick={() => flow.change("email")}>
          <Trans>Back to sign in</Trans>
        </AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

export type ResetLink = { userId: string; code: string };

export function ResetPasswordForm({
  flow,
  link,
  secondsLeft,
  restart,
}: {
  flow: Flow;
  link: ResetLink | null;
  secondsLeft: number;
  restart: (seconds: number) => void;
}) {
  const { t } = useLingui();
  const [code, setCode] = useState(codeDigits(link?.code ?? ""));
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reset = useResetPassword(handled);
  const again = useRequestPasswordReset(handled);
  const email = flow.email.trim();
  const submit = () => {
    setFailure(null);
    reset.mutate(
      {
        data: {
          ...(email === "" ? { user_id: link?.userId ?? null } : { email }),
          code,
          password,
          return_to: flow.returnTo,
        },
      },
      {
        onSuccess: (response) => {
          if (response.status === 200) flow.land(response.data);
        },
        onError: (error) => {
          setFailure(messageOf(error, t`Could not reset the password.`));
          if (error instanceof ApiError && error.problem?.code === "invalid-code") setCode("");
        },
      },
    );
  };
  const sendAgain = () => {
    if (secondsLeft > 0 || email === "") return;
    again.mutate(
      { data: { email } },
      {
        onSuccess: (response) => {
          if (response.status !== 200) return;
          setCode("");
          setFailure(null);
          restart(response.data.resend_seconds);
          setNotice(t`A new code is on its way. The old one stops working.`);
        },
        onError: (error) => setFailure(problemText(error, t`Could not send the code.`)),
      },
    );
  };
  return (
    <AuthForm center>
      <AuthBadge icon="mail" />
      <AuthHeading title={t`Choose a new password`}>
        {email === "" ? (
          <Trans>Check the code from your email, then enter a new password.</Trans>
        ) : (
          <Trans>
            Enter the {codeLength}-digit code we sent to <b>{email}</b>, then a new password.
          </Trans>
        )}
      </AuthHeading>
      <CodeInput label={t`Reset code`} value={code} onChange={setCode} onSubmit={() => undefined} />
      <AuthField label={t`New password`}>
        <PasswordInput
          id="reset-password"
          label={t`New password`}
          fresh
          value={password}
          onChange={setPassword}
          onSubmit={submit}
        />
      </AuthField>
      {notice === null ? null : (
        <Banner inline tone="info" icon="check">
          {notice}
        </Banner>
      )}
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
        disabled={code.length < codeLength || password === "" || reset.isPending}
      >
        <Trans>Set password and sign in</Trans>
      </Button>
      <AuthFoot>
        <AuthLink onClick={() => flow.change("forgot")}>
          <Trans>Change the address</Trans>
        </AuthLink>
        {email === "" ? null : (
          <>
            <DotSeparator />
            <AuthLink onClick={sendAgain}>
              {secondsLeft > 0 ? t`Resend in ${clock(secondsLeft)}` : t`Resend the code`}
            </AuthLink>
          </>
        )}
      </AuthFoot>
    </AuthForm>
  );
}

export function PasswordResetScene({
  flow,
  scene,
  link = null,
}: {
  flow: Flow;
  scene: "forgot" | "reset";
  link?: ResetLink | null;
}) {
  const [secondsLeft, setSecondsLeft] = useCountdown(0);
  if (scene === "reset" && (flow.email.trim() !== "" || link !== null)) {
    return (
      <ResetPasswordForm
        flow={flow}
        link={link}
        secondsLeft={secondsLeft}
        restart={setSecondsLeft}
      />
    );
  }
  return (
    <ForgotPasswordForm
      flow={flow}
      sent={(seconds) => {
        setSecondsLeft(seconds);
        flow.change("reset");
      }}
    />
  );
}
