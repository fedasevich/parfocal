import { Trans, useLingui } from "@lingui/react/macro";
import { type SignInLanding, useSignInWithPassword } from "@parfocal/api-client";
import {
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  DotSeparator,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { useState } from "react";
import { startNamedLogin } from "../../session/sign-in-redirect.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { handled, PasswordInput, problemText } from "./auth-inputs.tsx";
import type { SignInScene } from "./scenes.ts";

export type Flow = {
  email: string;
  setEmail: (email: string) => void;
  returnTo: string | null;
  change: (scene: SignInScene) => void;
  land: (session: SignInLanding) => void;
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

export function EmailForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const { email } = flow;
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const signIn = useSignInWithPassword(handled);
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
  return (
    <AuthForm>
      <AuthHeading title={t`Sign in to Parfocal`} />
      <EmailField flow={flow} />
      <AuthField label={t`Password`}>
        <PasswordInput
          id="sign-in-password"
          label={t`Password`}
          value={password}
          onChange={setPassword}
          onSubmit={submit}
        />
      </AuthField>
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
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
      <Button variant="primary" size="lg" block onClick={submit} disabled={signIn.isPending}>
        <Trans>Sign in</Trans>
      </Button>
      <Button
        size="lg"
        block
        onClick={() => void startNamedLogin({ returnTo: flow.returnTo ?? "/", loginHint: email })}
      >
        <Icon name="key" />
        <Trans>Sign in with a passkey</Trans>
      </Button>
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
