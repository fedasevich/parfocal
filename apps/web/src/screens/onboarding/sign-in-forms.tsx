import { Trans, useLingui } from "@lingui/react/macro";
import { listPasskeys, type SignInLanding, useSignInWithPassword } from "@parfocal/api-client";
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
import { useEffect, useRef, useState } from "react";
import {
  addPasskey,
  autofillAvailable,
  declinePasskeyOffer,
  PasskeyCancelledError,
  passkeyOfferDeclined,
  platformPasskeyAvailable,
  rememberedPasskeyEmail,
  rememberPasskeyEmail,
  signInWithPasskey,
} from "../../session/passkeys.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { handled, PasswordInput, problemText } from "./auth-inputs.tsx";
import type { SignInScene } from "./scenes.ts";
import { emailDomain, organisationDomain, organisationSignInUrl } from "./sign-in-rules.ts";

export type Flow = {
  email: string;
  setEmail: (email: string) => void;
  returnTo: string | null;
  change: (scene: SignInScene) => void;
  land: (session: SignInLanding) => void;
  ssoUnknown: boolean;
};

function EmailField({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  return (
    <AuthField label={t`Work email`}>
      <Input
        aria-label={t`Work email`}
        type="email"
        autoComplete="username webauthn"
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
  const [offer, setOffer] = useState<SignInLanding | null>(null);
  const [autofill, setAutofill] = useState<AbortController | null>(null);
  const signIn = useSignInWithPassword(handled);
  const returnTo = flow.returnTo ?? "/";
  const { land } = flow;
  const landRef = useRef(land);
  landRef.current = land;
  const autofillSettled = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const remembered = rememberedPasskeyEmail();
    if (remembered === null) return;
    const controller = new AbortController();
    setAutofill(controller);
    autofillSettled.current = autofillAvailable().then(async (available) => {
      if (!available || controller.signal.aborted) return;
      await signInWithPasskey({
        email: remembered,
        returnTo,
        conditional: controller.signal,
      }).then(
        (landing) => landRef.current(landing),
        () => undefined,
      );
    });
    return () => controller.abort();
  }, [returnTo]);

  const passkey = () => {
    autofill?.abort();
    setFailure(null);
    const typed = email.trim() || rememberedPasskeyEmail() || "";
    if (typed === "") {
      setFailure(t`Enter your work email, then choose Sign in with a passkey.`);
      return;
    }
    autofillSettled.current
      .then(() => signInWithPasskey({ email: typed, returnTo }))
      .then(
        (landing) => {
          rememberPasskeyEmail(typed);
          land(landing);
        },
        (error: unknown) => {
          if (error instanceof PasskeyCancelledError) return;
          setFailure(problemText(error, t`Could not sign in with a passkey. Try again.`));
        },
      );
  };

  const afterPassword = async (landing: SignInLanding) => {
    if (passkeyOfferDeclined() || !(await platformPasskeyAvailable())) {
      land(landing);
      return;
    }
    const saved = await listPasskeys().catch(() => null);
    if (saved?.status === 200 && saved.data.length === 0) setOffer(landing);
    else land(landing);
  };
  const submit = () => {
    setFailure(null);
    signIn.mutate(
      { data: { email, password, keep_signed_in: keep, return_to: flow.returnTo } },
      {
        onSuccess: (response) => {
          if (response.status === 200) void afterPassword(response.data);
        },
        onError: (error) => setFailure(problemText(error, t`Could not sign in. Try again.`)),
      },
    );
  };
  if (offer !== null) return <PasskeyOffer email={email} landing={offer} land={land} />;
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
      <AuthFoot>
        <AuthLink className="min-h-6" onClick={() => flow.change("forgot")}>
          <Trans>Forgot your password?</Trans>
        </AuthLink>
      </AuthFoot>
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
      <Button size="lg" block onClick={passkey}>
        <Icon name="key" />
        <Trans>Sign in with a passkey</Trans>
      </Button>
      <Button size="lg" block onClick={() => flow.change("sso")}>
        <Icon name="shield" />
        <Trans>Sign in with your organisation</Trans>
      </Button>
      <AuthFoot>
        <Trans>New to Parfocal?</Trans> <SignUpLink />
        <DotSeparator />
        <Trans>Invited? Open the link in your email</Trans>
      </AuthFoot>
    </AuthForm>
  );
}

function PasskeyOffer({
  email,
  landing,
  land,
}: {
  email: string;
  landing: SignInLanding;
  land: (session: SignInLanding) => void;
}) {
  const { t } = useLingui();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const save = () => {
    setSaving(true);
    setFailure(null);
    addPasskey().then(
      () => {
        rememberPasskeyEmail(email);
        land(landing);
      },
      (error: unknown) => {
        setSaving(false);
        if (error instanceof PasskeyCancelledError) return;
        setFailure(problemText(error, t`Could not save the passkey. Try again.`));
      },
    );
  };
  return (
    <AuthForm>
      <AuthHeading title={t`Sign in without a password next time`}>
        <Trans>
          Save a passkey in your iCloud Keychain or password manager. Next time you sign in with
          Touch ID, your phone or a security key.
        </Trans>
      </AuthHeading>
      {failure === null ? null : (
        <Banner inline tone="bad" icon="warn">
          {failure}
        </Banner>
      )}
      <Button variant="primary" size="lg" block onClick={save} disabled={saving}>
        <Icon name="key" />
        <Trans>Save a passkey</Trans>
      </Button>
      <Button
        size="lg"
        block
        onClick={() => {
          declinePasskeyOffer();
          land(landing);
        }}
      >
        <Trans>Not now</Trans>
      </Button>
    </AuthForm>
  );
}

export function SsoForm({ flow }: { flow: Flow }) {
  const { t } = useLingui();

  const [text, setText] = useState(() => emailDomain(flow.email));
  const domain = organisationDomain(text);
  const go = () => {
    if (domain !== null) window.location.assign(organisationSignInUrl(domain, flow.returnTo));
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
          onKeyDown={(event) => {
            if (event.key === "Enter") go();
          }}
          className="h-9"
        />
      </AuthField>
      {flow.ssoUnknown ? (
        <Banner inline tone="bad" icon="warn">
          {t`No Parfocal workspace signs in that email domain through your organisation. Check the domain, or go back and sign in with your email.`}
        </Banner>
      ) : null}
      <Button variant="primary" size="lg" block onClick={go} disabled={domain === null}>
        <Trans>Continue to your organisation's sign-in</Trans>
      </Button>
      <AuthFoot>
        <AuthLink onClick={() => flow.change("email")}>
          <Trans>Back</Trans>
        </AuthLink>
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
