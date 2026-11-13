import {
  ApiError,
  useConfirmEmail,
  useCreateAccount,
  useResendEmailCode,
  useStartSso,
} from "@parfocal/api-client";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  ChoiceTile,
  DotSeparator,
  OrDivider,
  PasswordMeter,
  SsoButton,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Stepper } from "@parfocal/ui/components/flow-page";
import { Input } from "@parfocal/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useGoTo } from "../../shell/router-link.tsx";
import { CodeInput, handled, PasswordInput, problemText, useCountdown } from "./auth-inputs.tsx";
import { PitchLayout, useSignInOptions, workspaceOf } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { SignUpScene } from "./scenes.ts";
import { checkPassword, clock, codeLength, institutionFor } from "./sign-in-rules.ts";
import { setupAfterSignUp, signUpProblem, strengthLine } from "./sign-up-rules.ts";

type Props = { scene: SignUpScene; change: (scene: SignUpScene) => void };

type Mostly = "run" | "review";

const signUpSteps = (scene: SignUpScene) => [
  { label: "Account", why: "Create the account first." },
  { label: "Confirm email", ...(scene === "form" ? { why: "Create the account first." } : {}) },
  { label: "Set up", why: "Confirm your email first. Setup starts after the code." },
];

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.fieldErrors().length > 0
    ? error
        .fieldErrors()
        .map((item) => item.message)
        .join(". ")
    : problemText(error, fallback);

const Failure = ({ children }: { children: ReactNode }) =>
  children === null ? null : (
    <Banner inline tone="bad" icon="warn">
      {children}
    </Banner>
  );

export function SignUpScreen({ scene, change }: Props) {
  const options = useSignInOptions();
  const goTo = useGoTo();
  const queryClient = useQueryClient();
  const land = (path: string) => {
    void queryClient.invalidateQueries();
    void goTo(path);
  };
  const [notice, show] = useNotice();
  const [name, setName] = useState("");
  const [typedEmail, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostly, setMostly] = useState<Mostly>("review");
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useCountdown(0);
  const workspace = workspaceOf(options);
  const verifiedEmail = sentTo ?? (typedEmail.trim() || options?.email) ?? "";
  const steps = (
    <Stepper
      steps={signUpSteps(scene)}
      current={scene === "form" ? 0 : 1}
      onStepSelect={(index) => index === 0 && change("form")}
      className="mb-1 justify-center"
    />
  );
  if (scene === "verify") {
    return (
      <PitchLayout>
        <VerifyForm
          steps={steps}
          email={verifiedEmail}
          secondsLeft={secondsLeft}
          restart={setSecondsLeft}
          change={change}
          toast={show}
          land={land}
        />
        {notice}
      </PitchLayout>
    );
  }
  return (
    <PitchLayout>
      <FormScreen
        steps={steps}
        workspace={workspace}
        details={{ name, email: typedEmail, password, mostly, acceptedTerms }}
        set={{
          setName,
          setEmail: (value) => {
            setEmail(value);
            setSentTo(null);
          },
          setPassword,
          setMostly,
          setAcceptedTerms,
        }}
        onCreated={(email, resendSeconds) => {
          setSentTo(email);
          setSecondsLeft(resendSeconds);
          change("verify");
        }}
        land={land}
        signIn={() => void goTo("/sign-in")}
      />
    </PitchLayout>
  );
}

type FormProps = {
  steps: ReactNode;
  workspace: ReturnType<typeof workspaceOf>;
  details: {
    name: string;
    email: string;
    password: string;
    mostly: Mostly;
    acceptedTerms: boolean;
  };
  set: {
    setName: (value: string) => void;
    setEmail: (value: string) => void;
    setPassword: (value: string) => void;
    setMostly: (value: Mostly) => void;
    setAcceptedTerms: (value: boolean) => void;
  };
  onCreated: (email: string, resendSeconds: number) => void;
  land: (path: string) => void;
  signIn: () => void;
};

function FormScreen({ steps, workspace, details, set, onCreated, land, signIn }: FormProps) {
  const options = useSignInOptions();
  const [failure, setFailure] = useState<string | null>(null);
  const create = useCreateAccount(handled);
  const sso = useStartSso(handled);
  const check = checkPassword(details.password, []);
  const matched = institutionFor(details.email, options?.institutions ?? []);
  const ssoWorkspace = matched
    ? { name: matched.name, logo: matched.logo, colour: matched.colour }
    : workspace;
  const ssoName = matched?.short_name ?? workspace.name;
  const submit = () => {
    const problem = signUpProblem(details);
    setFailure(problem);
    if (problem !== null) return;
    create.mutate(
      {
        data: {
          name: details.name.trim(),
          email: details.email.trim(),
          password: details.password,
          role: details.mostly,
          accepted_terms: details.acceptedTerms,
        },
      },
      {
        onSuccess: (response) => {
          if (response.status === 200) onCreated(response.data.email, response.data.resend_seconds);
        },
        onError: (error) => setFailure(messageOf(error, "Could not create the account.")),
      },
    );
  };
  const continueWithSso = () => {
    const workspaceId = matched?.workspace_id ?? options?.workspace.id;
    if (workspaceId === undefined) return;
    setFailure(null);
    sso.mutate(
      { data: { workspace_id: workspaceId, return_to: setupAfterSignUp } },
      {
        onSuccess: (response) => {
          if (response.status === 200) land(response.data.return_to);
        },
        onError: (error) => setFailure(problemText(error, "Single sign-on did not answer.")),
      },
    );
  };
  return (
    <AuthForm>
      {steps}
      <AuthHeading title="Create your Parfocal account">
        Free for academic research. Your workspace can invite you later.
      </AuthHeading>
      {options?.methods.sso === false ? null : (
        <>
          <SsoButton workspace={ssoWorkspace} onClick={continueWithSso} disabled={sso.isPending}>
            Sign up with {ssoName} single sign-on
          </SsoButton>
          <OrDivider>or with your email</OrDivider>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <AuthField label="Full name">
          <Input
            aria-label="Full name"
            autoComplete="name"
            value={details.name}
            onChange={(event) => set.setName(event.target.value)}
            className="h-9"
          />
        </AuthField>
        <AuthField label="Work email">
          <Input
            aria-label="Work email"
            type="email"
            autoComplete="username"
            value={details.email}
            onChange={(event) => set.setEmail(event.target.value)}
            className="h-9"
          />
        </AuthField>
      </div>
      <AuthField label="Password">
        <PasswordInput
          id="sign-up-password"
          label="Password"
          fresh
          value={details.password}
          onChange={set.setPassword}
          onSubmit={submit}
        />
      </AuthField>
      <PasswordMeter
        strength={check.strength}
        label={strengthLine(check.label, details.password)}
      />
      <AuthField label="I mostly">
        <div role="radiogroup" aria-label="I mostly" className="grid grid-cols-2 gap-2.5">
          <ChoiceTile
            icon="flask"
            title="Run evaluations"
            detail="Upload slides and AI results, assign reviews"
            selected={details.mostly === "run"}
            onClick={() => set.setMostly("run")}
          />
          <ChoiceTile
            icon="check"
            title="Review AI results"
            detail="Check, fix and comment on what the AI found"
            selected={details.mostly === "review"}
            onClick={() => set.setMostly("review")}
          />
        </div>
      </AuthField>
      <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
        <Checkbox
          id="sign-up-terms"
          checked={details.acceptedTerms}
          onCheckedChange={(checked) => set.setAcceptedTerms(checked === true)}
        />
        <label htmlFor="sign-up-terms">
          I agree to the terms and the data processing agreement
        </label>
      </span>
      <Failure>{failure}</Failure>
      <Button variant="primary" size="lg" block onClick={submit} disabled={create.isPending}>
        Create account
      </Button>
      <AuthFoot>
        Already have an account? <AuthLink onClick={signIn}>Sign in</AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}

type VerifyProps = {
  steps: ReactNode;
  email: string;
  secondsLeft: number;
  restart: (seconds: number) => void;
  change: (scene: SignUpScene) => void;
  toast: (text: string) => void;
  land: (path: string) => void;
};

function VerifyForm({ steps, email, secondsLeft, restart, change, toast, land }: VerifyProps) {
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const confirm = useConfirmEmail(handled);
  const resend = useResendEmailCode(handled);
  const submit = () => {
    setFailure(null);
    confirm.mutate(
      { data: { email, code } },
      {
        onSuccess: (response) => {
          if (response.status === 200) land(response.data.return_to);
        },
        onError: (error) => {
          setFailure(problemText(error, "Could not check the code."));
          setCode("");
        },
      },
    );
  };
  const sendAgain = () => {
    if (secondsLeft > 0) return;
    resend.mutate(
      { data: { email } },
      {
        onSuccess: (response) => {
          if (response.status !== 200) return;
          setCode("");
          setFailure(null);
          restart(response.data.resend_seconds);
          toast("A new code is on its way. The old one stops working");
        },
        onError: (error) => setFailure(problemText(error, "Could not send the code.")),
      },
    );
  };
  return (
    <AuthForm center>
      {steps}
      <AuthBadge icon="mail" />
      <AuthHeading title="Confirm your email">
        Enter the {codeLength}-digit code we sent to <b>{email}</b>.
      </AuthHeading>
      <CodeInput label="Confirmation code" value={code} onChange={setCode} onSubmit={submit} />
      <Failure>{failure}</Failure>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={submit}
        disabled={code.length < codeLength || confirm.isPending}
      >
        Confirm and set up
      </Button>
      <AuthFoot>
        Wrong address? <AuthLink onClick={() => change("form")}>Change it</AuthLink>
        <DotSeparator />
        <AuthLink onClick={sendAgain}>
          {secondsLeft > 0 ? `Resend in ${clock(secondsLeft)}` : "Resend the code"}
        </AuthLink>
      </AuthFoot>
    </AuthForm>
  );
}
