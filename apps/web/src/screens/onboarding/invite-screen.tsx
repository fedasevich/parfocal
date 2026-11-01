import { useAcceptInvitation, useGetInvitePreview } from "@parfocal/api-client";
import {
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  DotSeparator,
  PasswordMeter,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Stepper } from "@parfocal/ui/components/flow-page";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { now } from "../../clock.ts";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue, plural } from "../format.ts";
import { projectColour } from "../palette.ts";
import { toPersonInfo } from "../people.ts";
import { PitchLayout } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { InviteScene } from "./scenes.ts";

type Props = { token: string; scene: InviteScene; change: (scene: InviteScene) => void };

const inviteSteps = (scene: InviteScene) => [
  { label: "Invite", why: "Accept the invite first." },
  { label: "Your account", ...(scene === "landing" ? { why: "Accept the invite first." } : {}) },
  { label: "First slide", why: "Join first. Your first slide opens after that." },
];

function Fact({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="flex items-center gap-2 text-fg-dim">
        <Icon name={icon} />
        {label}
      </dt>
      <dd className="m-0 min-w-0 text-fg">{children}</dd>
    </div>
  );
}

export function InviteScreen({ token, scene, change }: Props) {
  const preview = useGetInvitePreview(token).data?.data;
  const accept = useAcceptInvitation();
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const steps = (
    <Stepper
      steps={inviteSteps(scene)}
      current={scene === "landing" ? 0 : 1}
      onStepSelect={(index) => index === 0 && change("landing")}
      className="mb-1"
    />
  );
  if (preview === undefined) return <PitchLayout>{null}</PitchLayout>;
  const join = () =>
    accept.mutate(
      { data: { token } },
      {
        onSuccess: () =>
          void goTo(
            destinations.slide(preview.project.id, preview.task.first_slide_id, preview.task.id),
          ),
      },
    );
  const inviter = toPersonInfo(preview.invited_by);
  if (scene === "account") {
    return (
      <PitchLayout>
        <AuthForm>
          {steps}
          <AuthHeading title={`Join ${preview.project.name}`}>
            One step, then your first slide opens.
          </AuthHeading>
          <AuthField label="Email" aside={<span className="text-fg-faint">from the invite</span>}>
            <Input aria-label="Email" value={preview.email} readOnly className="h-9 opacity-80" />
          </AuthField>
          <AuthField label="Full name">
            <Input aria-label="Full name" defaultValue={preview.name} className="h-9" />
          </AuthField>
          <AuthField label="Password">
            <Input
              aria-label="Password"
              type="password"
              defaultValue="correct-horse!"
              className="h-9 font-mono"
            />
          </AuthField>
          <PasswordMeter strength={3} label="Strong" />
          <AuthField label="Specialty">
            <Input aria-label="Specialty" defaultValue={preview.specialty ?? ""} className="h-9" />
          </AuthField>
          <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
            <Checkbox id="invite-terms" defaultChecked />
            <label htmlFor="invite-terms">
              I agree to the terms and the data processing agreement
            </label>
          </span>
          <Button variant="primary" size="lg" block onClick={join}>
            Join and open my first slide
          </Button>
          <AuthFoot>
            <AuthLink onClick={join}>Use Vltava single sign-on instead</AuthLink>
          </AuthFoot>
        </AuthForm>
      </PitchLayout>
    );
  }
  return (
    <PitchLayout>
      <AuthForm width="wide">
        {steps}
        <AuthHeading title="You're invited">
          Accept to see the slides. Nothing is shared until you do.
        </AuthHeading>
        <section
          aria-label="The invite"
          className="grid gap-3.5 rounded-xl border border-line bg-chrome p-4 text-left"
        >
          <div className="flex items-center gap-2.5">
            <PersonAvatar person={inviter} size={32} />
            <span>
              <b>{inviter.name}</b> invited you to review
              <small className="block text-body-sm text-fg-dim">
                {preview.invited_by.title} ·{" "}
                {plural(
                  Math.max(
                    1,
                    Math.round((now().getTime() - Date.parse(preview.sent_at)) / 3_600_000),
                  ),
                  "hour",
                )}{" "}
                ago
              </small>
            </span>
          </div>
          <div className="flex items-center gap-2.5 rounded-[10px] bg-chrome-2 px-3 py-2.5">
            <span
              aria-hidden="true"
              className="h-8.5 w-1.5 flex-none rounded-[3px]"
              style={{ background: projectColour(preview.project.colour) }}
            />
            <span className="flex-1">
              <b className="block text-body">{preview.project.name}</b>
              <small className="block font-mono text-caption text-fg-faint">
                {preview.project.code} · {preview.project.study_template}
              </small>
            </span>
            <StatusTag tone="accent">
              {preview.project.privacy_mode === "clinical" ? "Clinical" : "De-identified"}
            </StatusTag>
          </div>
          <dl className="m-0 grid grid-cols-[132px_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-sm">
            <Fact icon="flag" label="Task">
              <span className="font-mono">{preview.task.code}</span> · {preview.task.name}
            </Fact>
            <Fact icon="slides" label="Slides">
              {preview.task.slides} slides, about {preview.task.hours} hours
            </Fact>
            <Fact icon="target" label="What to check">
              {preview.task.scope}
            </Fact>
            <Fact icon="calendar" label="Due">
              {formatDue(preview.task.due_on)}
            </Fact>
            <Fact icon="eye-off" label="Review">
              {preview.task.blinded
                ? "Blind. You see other reviewers after you submit."
                : "Open. You see other reviewers as you go."}
            </Fact>
          </dl>
          {preview.project.privacy_mode === "de-identified" ? (
            <Banner inline tone="info" icon="shield">
              This project is de-identified. You will not see patient names or numbers.
            </Banner>
          ) : null}
        </section>
        <Button variant="primary" size="lg" block onClick={() => change("account")}>
          Accept and create my account
        </Button>
        <Button size="lg" block onClick={() => void goTo("/sign-in")}>
          I already have an account, sign in
        </Button>
        <AuthFoot>
          <AuthLink
            onClick={() =>
              show(
                `${inviter.name.split(" ")[0]} is told you declined, with an optional note (mock)`,
              )
            }
          >
            Decline
          </AuthLink>
          <DotSeparator />
          The invite expires on {formatDue(preview.expires_on)}
        </AuthFoot>
      </AuthForm>
      {notice}
    </PitchLayout>
  );
}
