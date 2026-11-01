import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  NameCell,
  SettingRow,
  StatStrip,
  StorageBar,
  SummaryRow,
} from "../src/components/admin.tsx";
import {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLayout,
  AuthLink,
  AuthPitchSide,
  AuthStepsSide,
  ChoiceOption,
  ChoiceTile,
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
} from "../src/components/auth.tsx";
import { Button } from "../src/components/button.tsx";
import { Icon } from "../src/components/icon.tsx";
import { Input } from "../src/components/input.tsx";
import { StatusTag } from "../src/components/tag.tsx";
import { Zone } from "../src/components/zone.tsx";
import { mockAssets, people } from "./fixtures.ts";

const meta = {
  title: "Components/Sign-in and admin",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const vltava = { name: "Fakultní nemocnice Vltava", logo: "FV", colour: "#0f766e" };
const lab = { name: "Charles University AI Lab", logo: "CU", colour: "#7c3aed" };

export const SignInPage: Story = {
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <Story />],
  render: () => (
    <AuthLayout
      side={
        <AuthPitchSide
          workspace={vltava}
          imageUrl={mockAssets.mid}
          ids={[
            { id: "T1", text: "tumor region · 0.97", x: 80, y: 130 },
            { id: "T1·C145", text: "tumor cell · 0.91", x: 290, y: 205 },
          ]}
        />
      }
    >
      <AuthForm>
        <AuthHeading title="Sign in to Parfocal">Fakultní nemocnice Vltava workspace</AuthHeading>
        <DeepLinkNote>
          After you sign in: <b>RT-14</b>, slide <b>A1</b> of <b>S26-04812</b>
        </DeepLinkNote>
        <SsoButton workspace={vltava}>Continue with Vltava single sign-on</SsoButton>
        <OrDivider>or with your email</OrDivider>
        <AuthField label="Work email">
          <Input aria-label="Work email" defaultValue="lenka@fnvltava.example" />
        </AuthField>
        <AuthField label="Password" aside={<AuthLink>Forgot password?</AuthLink>}>
          <Input aria-label="Password" type="password" defaultValue="correct horse" />
        </AuthField>
        <Button variant="primary" className="h-10 w-full">
          Sign in
        </Button>
        <AuthFoot>
          New to Parfocal? <AuthLink>Create an account</AuthLink>
          <DotSeparator />
          Invited? Open the link in your email
        </AuthFoot>
      </AuthForm>
    </AuthLayout>
  ),
};

export const SetupSide: Story = {
  render: () => (
    <div className="h-130 w-140">
      <AuthStepsSide
        workspace={vltava}
        steps={[
          { name: "You", sub: "Reviewer · Breast, Lymph nodes" },
          { name: "Workspace", sub: "Join or create one" },
          { name: "First project", sub: "Sample or your own" },
          { name: "Viewer", sub: "Input device and theme" },
          { name: "Done", sub: "Getting started" },
        ]}
        current={1}
        reached={1}
        onStepSelect={() => undefined}
        note="Everything here can be changed later in Settings. Skip any step."
      />
    </div>
  ),
};

export const CodeAndPassword: Story = {
  render: () => (
    <AuthForm center>
      <AuthBadge icon="mail" />
      <AuthHeading title="Confirm your email">
        Enter the 6-digit code we sent to <b>lenka@fnvltava.example</b>.
      </AuthHeading>
      <CodeBoxes digits="2709" aria-label="Confirmation code, 4 of 6 digits" />
      <PasswordMeter strength={3} label="Strong" />
      <PasswordMeter strength={2} label="Fair" />
      <RequirementList
        items={[
          { text: "At least 12 characters", met: true },
          { text: "Not one you used before", met: false },
        ]}
      />
    </AuthForm>
  ),
};

function Choices() {
  const [role, setRole] = useState("rev");
  const [ws, setWs] = useState("fv");
  return (
    <div className="grid w-180 gap-4">
      <div role="radiogroup" aria-label="Role" className="grid grid-cols-3 gap-2.5">
        {[
          ["res", "flask", "Researcher", "Upload slides and AI results, assign reviews"],
          ["rev", "check", "Reviewer", "Check, fix and comment on AI results"],
          ["both", "users", "Both", "Run your own evaluations and review for others"],
        ].map(([key = "", icon, title, detail]) => (
          <ChoiceTile
            key={key}
            icon={icon === "flask" ? "flask" : icon === "check" ? "check" : "users"}
            title={title}
            detail={detail}
            selected={role === key}
            onClick={() => setRole(key)}
            badge={key === "rev" ? <StatusTag tone="accent">Recommended</StatusTag> : undefined}
          />
        ))}
      </div>
      <div role="radiogroup" aria-label="Workspace" className="grid gap-2">
        {[
          {
            key: "fv",
            workspace: vltava,
            detail: "fnvltava.example matches your email · 24 members",
          },
          { key: "cu", workspace: lab, detail: "Asks someone with admin rights to let you in" },
        ].map((option) => (
          <ChoiceOption
            key={option.key}
            lead={<WorkspaceLogo workspace={option.workspace} />}
            title={option.workspace.name}
            detail={option.detail}
            selected={ws === option.key}
            onClick={() => setWs(option.key)}
            end={
              option.key === "fv" ? <StatusTag tone="ok">You join at once</StatusTag> : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

export const ChoiceTilesAndOptions: Story = { render: () => <Choices /> };

export const Passkey: Story = {
  render: () => (
    <div className="relative h-90 w-110">
      <PasskeySheet
        kind="touch"
        person={{ ...people.LM, email: "lenka@fnvltava.example" }}
        onContinue={() => undefined}
        onCancel={() => undefined}
        onOther={() => undefined}
      />
    </div>
  ),
};

export const PasskeyOnAPhone: Story = {
  render: () => (
    <div className="relative h-90 w-110">
      <PasskeySheet
        kind="qr"
        onContinue={() => undefined}
        onCancel={() => undefined}
        onBack={() => undefined}
      />
    </div>
  ),
};

export const Locked: Story = {
  render: () => (
    <div
      className="relative h-130 w-180 bg-cover bg-center"
      style={{ backgroundImage: `url(${mockAssets.mid})` }}
    >
      <LockCard
        person={people.LM}
        minutes={15}
        onUnlock={() => undefined}
        onPasskey={() => undefined}
        onLogOut={() => undefined}
      />
    </div>
  ),
};

export const AdminStats: Story = {
  render: () => (
    <div className="w-220">
      <StatStrip
        stats={[
          { value: "24", label: "People", detail: "3 invites waiting" },
          { value: "6", label: "AI models", detail: "2 runs going now" },
          { value: "1.2 TB", label: "Stored, of 5 TB", detail: "3.4 TB more read in place" },
          { value: "148", label: "Webhook calls today", detail: "1 rejected" },
        ]}
      />
    </div>
  ),
};

export const Storage: Story = {
  render: () => (
    <div className="grid w-140 gap-6">
      <StorageBar
        totalTb={5}
        parts={[
          { label: "Copied slides", tb: 0.7, colour: "var(--st-1)" },
          { label: "Tile cache for remote slides, kept 7 days", tb: 0.3, colour: "var(--st-2)" },
          { label: "Results, IDs and reviews", tb: 0.2, colour: "var(--st-3)" },
        ]}
        foot="Read in place, not counted: 3.4 TB stays on your sources"
      />
      <StorageBar
        size="sm"
        totalTb={5}
        parts={[{ label: "Copied slides", tb: 4.9, colour: "var(--st-1)" }]}
      />
    </div>
  ),
};

export const SettingsAndRows: Story = {
  render: () => (
    <div className="grid w-140 gap-4">
      <Zone title="Sign-in">
        <SettingRow label="Vltava single sign-on" detail="SAML · connected" on />
        <SettingRow label="Watermark exports" detail="Puts a name on exports" on={false} />
        <SettingRow label="Two factors with admin rights" detail="Always required" on locked />
      </Zone>
      <Zone title="AI models">
        <SummaryRow>
          <NameCell
            lead={<Icon name="smart" />}
            title="CAMELYON tumor model"
            version="v1.0"
            sub="Parfocal GPU"
          />
          <StatusTag tone="ok">Active</StatusTag>
        </SummaryRow>
        <SummaryRow>
          <NameCell
            lead={<Icon name="smart" />}
            title="Lab HoVer-Net fork"
            version="v2.1"
            sub="Your server"
          />
          <StatusTag tone="ok">Answering · 410 ms</StatusTag>
        </SummaryRow>
      </Zone>
    </div>
  ),
};
