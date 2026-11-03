import type { Meta, StoryObj } from "@storybook/react-vite";
import { type SyntheticEvent, useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  CheckboxField,
  characterCount,
  FormField,
  RadioField,
  TextAreaInput,
  TextFieldInput,
} from "../src/components/form-field.tsx";
import { RadioRow } from "../src/components/radio-group.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/select.tsx";

const meta = {
  title: "Components/Form fields",
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const focusFirst: Story["play"] = ({ canvasElement }) => {
  canvasElement
    .querySelector<HTMLElement>(
      "[data-focus-target] :is(input, textarea, button, [role=checkbox], [role=radio]):not([tabindex='-1']):not([aria-hidden=true]):not([type=hidden])",
    )
    ?.focus();
};

export const TextField: Story = {
  render: () => (
    <div className="grid gap-5">
      <div data-focus-target>
        <FormField label="Work email" required help="We send the sign in link here.">
          <TextFieldInput type="email" placeholder="name@hospital.example" />
        </FormField>
      </div>
      <FormField label="Task name" help="Reviewers see it in My work.">
        <TextFieldInput placeholder="Sentinel node AI evaluation" />
      </FormField>
      <FormField label="Model name" required>
        <TextFieldInput defaultValue="Nuclei detector v2" />
      </FormField>
      <FormField
        label="Endpoint"
        required
        error="The address needs to start with https://. Add it at the front."
      >
        <TextFieldInput defaultValue="models.example.org/infer" />
      </FormField>
      <FormField label="Project" disabled help="Set when the task was created.">
        <TextFieldInput defaultValue="P07 Sentinel nodes" />
      </FormField>
    </div>
  ),
  play: focusFirst,
};

const noteLimit = 300;

function NoteField({
  label,
  initial = "",
  error,
  disabled,
  help,
}: {
  label: string;
  initial?: string;
  error?: string;
  disabled?: boolean;
  help?: string;
}) {
  const [text, setText] = useState(initial);
  return (
    <FormField
      label={label}
      optional
      help={help}
      error={error}
      disabled={disabled ?? false}
      count={characterCount(text, noteLimit)}
    >
      <TextAreaInput
        value={text}
        maxLength={noteLimit}
        onChange={(event) => setText(event.target.value)}
      />
    </FormField>
  );
}

export const TextArea: Story = {
  render: () => (
    <div className="grid gap-5">
      <div data-focus-target>
        <NoteField label="Message to reviewers" help="Shown above the first slide." />
      </div>
      <NoteField
        label="Reason"
        initial="Margins look clean on every level we cut."
        help="Other reviewers see your reason."
      />
      <NoteField
        label="Change note"
        initial="Fix"
        error="The note is too short to explain the change. Use at least 10 characters."
      />
      <NoteField label="Previous note" initial="Signed and locked." disabled />
    </div>
  ),
  play: focusFirst,
};

const stains = [
  { label: "H&E", value: "he" },
  { label: "Ki-67", value: "ki67" },
  { label: "HER2", value: "her2" },
];

function StainField({
  label,
  value,
  error,
  disabled,
  help,
}: {
  label: string;
  value?: string;
  error?: string;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <FormField label={label} required help={help} error={error} disabled={disabled ?? false}>
      <Select items={stains} defaultValue={value ?? null} disabled={disabled ?? false}>
        <SelectTrigger className="w-full border-line-strong group-data-invalid/field:border-bad">
          <SelectValue placeholder="Pick a stain" />
        </SelectTrigger>
        <SelectContent>
          {stains.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export const SelectField: Story = {
  render: () => (
    <div className="grid gap-5">
      <div data-focus-target>
        <StainField label="Stain" help="The model only reads this stain." />
      </div>
      <StainField label="Second stain" value="ki67" />
      <StainField
        label="Counter stain"
        error="No stain is picked. Pick the stain the slides were cut with."
      />
      <StainField label="Locked stain" value="he" disabled />
    </div>
  ),
  play: focusFirst,
};

export const CheckboxStates: Story = {
  render: () => (
    <div className="grid gap-4">
      <div data-focus-target>
        <CheckboxField
          label="Email me when the task is done"
          help="One email per task, never more."
        />
      </div>
      <CheckboxField label="Hide the AI confidence" defaultChecked />
      <CheckboxField
        label="I confirm the slides hold no patient names"
        required
        error="Confirm this before you send. Check the box once the slides are clean."
      />
      <CheckboxField
        label="Share with the whole lab"
        disabled
        help="Only owners can change this."
      />
    </div>
  ),
  play: focusFirst,
};

const orders = [
  { value: "ai", title: "AI order", text: "Most certain objects first." },
  { value: "random", title: "Random", text: "Everyone sees a different order." },
];

export const RadioStates: Story = {
  render: () => (
    <div className="grid gap-5">
      <div data-focus-target>
        <RadioField legend="Object order" help="Decides what reviewers see first.">
          {orders.map((item) => (
            <RadioRow key={item.value} {...item} />
          ))}
        </RadioField>
      </div>
      <RadioField legend="Second order" defaultValue="random">
        {orders.map((item) => (
          <RadioRow key={item.value} {...item} />
        ))}
      </RadioField>
      <RadioField
        legend="Round order"
        required
        error="No order is picked. Pick one so every reviewer gets the same rule."
      >
        {orders.map((item) => (
          <RadioRow key={item.value} {...item} />
        ))}
      </RadioField>
      <RadioField legend="Locked order" defaultValue="ai" disabled>
        {orders.map((item) => (
          <RadioRow key={item.value} {...item} disabled />
        ))}
      </RadioField>
    </div>
  ),
  play: focusFirst,
};

function SignInForm() {
  const [error, setError] = useState<string | undefined>();
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entry = new FormData(event.currentTarget).get("email");
    const email = typeof entry === "string" ? entry : "";
    setError(
      email.includes("@")
        ? undefined
        : "The email has no @ sign. Type the full address, like name@hospital.example.",
    );
  };
  return (
    <form noValidate className="grid gap-4" onSubmit={submit}>
      <FormField label="Work email" required error={error}>
        <TextFieldInput name="email" type="email" autoComplete="email" />
      </FormField>
      <Button type="submit">Send the link</Button>
    </form>
  );
}

export const ErrorKeepsTyping: Story = {
  render: () => <SignInForm />,
};
