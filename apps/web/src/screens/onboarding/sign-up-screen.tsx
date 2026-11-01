import { useGetMe } from "@parfocal/api-client";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  ChoiceTile,
  CodeBoxes,
  DotSeparator,
  OrDivider,
  PasswordMeter,
  SsoButton,
} from "@parfocal/ui/components/auth";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Stepper } from "@parfocal/ui/components/flow-page";
import { Input } from "@parfocal/ui/components/input";
import { useState } from "react";
import { useGoTo } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { PitchLayout, useSignInOptions, workspaceOf } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { SignUpScene } from "./scenes.ts";

type Props = { scene: SignUpScene; change: (scene: SignUpScene) => void };

const signUpSteps = (scene: SignUpScene) => [
  { label: "Account", why: "Create the account first." },
  { label: "Confirm email", ...(scene === "form" ? { why: "Create the account first." } : {}) },
  { label: "Set up", why: "Confirm your email first. Setup starts after the code." },
];

export function SignUpScreen({ scene, change }: Props) {
  const options = useSignInOptions();
  const me = okData(useGetMe().data);
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const [mostly, setMostly] = useState<"run" | "review">("review");
  const workspace = workspaceOf(options);
  const email = options?.email ?? "";
  const current = scene === "form" ? 0 : 1;
  const steps = (
    <Stepper
      steps={signUpSteps(scene)}
      current={current}
      onStepSelect={(index) => index === 0 && change("form")}
      className="mb-1 justify-center"
    />
  );
  if (scene === "verify") {
    return (
      <PitchLayout>
        <AuthForm center>
          {steps}
          <AuthBadge icon="mail" />
          <AuthHeading title="Confirm your email">
            Enter the 6-digit code we sent to <b>{email}</b>.
          </AuthHeading>
          <CodeBoxes digits="2709" aria-label="Confirmation code, 4 of 6 digits" />
          <Button variant="primary" size="lg" block onClick={() => void goTo("/setup?step=role")}>
            Confirm and set up
          </Button>
          <AuthFoot>
            Wrong address? <AuthLink onClick={() => change("form")}>Change it</AuthLink>
            <DotSeparator />
            <AuthLink onClick={() => show("A new code is on its way (mock)")}>
              Resend the code
            </AuthLink>
          </AuthFoot>
        </AuthForm>
        {notice}
      </PitchLayout>
    );
  }
  return (
    <PitchLayout>
      <AuthForm>
        {steps}
        <AuthHeading title="Create your Parfocal account">
          Free for academic research. Your workspace can invite you later.
        </AuthHeading>
        <SsoButton workspace={workspace} onClick={() => void goTo("/setup?step=role")}>
          Sign up with Vltava single sign-on
        </SsoButton>
        <OrDivider>or with your email</OrDivider>
        <div className="grid grid-cols-2 gap-3">
          <AuthField label="Full name">
            <Input
              key={me?.display_name}
              aria-label="Full name"
              defaultValue={me?.display_name ?? ""}
              className="h-9"
            />
          </AuthField>
          <AuthField label="Work email">
            <Input
              key={email}
              aria-label="Work email"
              type="email"
              defaultValue={email}
              className="h-9"
            />
          </AuthField>
        </div>
        <AuthField label="Password">
          <Input
            aria-label="Password"
            type="password"
            defaultValue="correct-horse!"
            className="h-9 font-mono"
          />
        </AuthField>
        <PasswordMeter strength={3} label="Strong · 14 characters" />
        <AuthField label="I mostly">
          <div role="radiogroup" aria-label="I mostly" className="grid grid-cols-2 gap-2.5">
            <ChoiceTile
              icon="flask"
              title="Run evaluations"
              detail="Upload slides and AI results, assign reviews"
              selected={mostly === "run"}
              onClick={() => setMostly("run")}
            />
            <ChoiceTile
              icon="check"
              title="Review AI results"
              detail="Check, fix and comment on what the AI found"
              selected={mostly === "review"}
              onClick={() => setMostly("review")}
            />
          </div>
        </AuthField>
        <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
          <Checkbox id="sign-up-terms" defaultChecked />
          <label htmlFor="sign-up-terms">
            I agree to the terms and the data processing agreement
          </label>
        </span>
        <Button variant="primary" size="lg" block onClick={() => change("verify")}>
          Create account
        </Button>
        <AuthFoot>
          Already have an account?{" "}
          <AuthLink onClick={() => void goTo("/sign-in")}>Sign in</AuthLink>
        </AuthFoot>
      </AuthForm>
    </PitchLayout>
  );
}
