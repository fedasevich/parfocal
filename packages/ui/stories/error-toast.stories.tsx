import { ApiError, type ErrorKind, type Problem } from "@parfocal/api-client";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Banner } from "../src/components/banner.tsx";
import { ErrorToast } from "../src/components/error-toast.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import { describeApiError, fieldErrorsByName } from "../src/lib/api-error.ts";

const leakedServerDetail =
  'Traceback (most recent call last): File "/srv/parfocal_api/app.py", line 12';

const problems: Record<ErrorKind, { status: number; problem?: Problem }> = {
  "bad-request": {
    status: 400,
    problem: {
      type: "https://parfocal.eu/problems/bad-request",
      title: "Bad request",
      status: 400,
      code: "bad-request",
      detail: "The slide is still being prepared. Try again when it shows Ready.",
    },
  },
  unauthenticated: {
    status: 401,
    problem: {
      type: "https://parfocal.eu/problems/unauthenticated",
      title: "Unauthenticated",
      status: 401,
      code: "unauthenticated",
      detail: leakedServerDetail,
    },
  },
  forbidden: {
    status: 403,
    problem: {
      type: "https://parfocal.eu/problems/forbidden",
      title: "Forbidden",
      status: 403,
      code: "forbidden",
    },
  },
  "not-found": {
    status: 404,
    problem: {
      type: "https://parfocal.eu/problems/not-found",
      title: "Not found",
      status: 404,
      code: "not-found",
    },
  },
  conflict: {
    status: 409,
    problem: {
      type: "https://parfocal.eu/problems/conflict",
      title: "Conflict",
      status: 409,
      code: "conflict",
    },
  },
  validation: {
    status: 422,
    problem: {
      type: "https://parfocal.eu/problems/validation",
      title: "Some fields are not valid",
      status: 422,
      code: "validation",
      errors: [
        { location: ["body", "name"], message: "Give the task a name.", code: "missing" },
        {
          location: ["body", "due_date"],
          message: "The due date is in the past.",
          code: "date_past",
        },
      ],
    },
  },
  server: {
    status: 500,
    problem: {
      type: "https://parfocal.eu/problems/internal",
      title: "Internal error",
      status: 500,
      code: "internal",
      detail: leakedServerDetail,
    },
  },
  network: { status: 0 },
};

function errorFor(kind: ErrorKind) {
  const { status, problem } = problems[kind];
  return new ApiError(kind, status, problem);
}

function KindToast({ kind }: { kind: ErrorKind }) {
  const [shown, setShown] = useState(true);
  const [acted, setActed] = useState(false);
  if (!shown) return <p className="m-0 text-body-sm text-fg-dim">Dismissed</p>;
  return (
    <div className="grid gap-3">
      <ErrorToast
        notice={describeApiError(errorFor(kind))}
        onAction={() => setActed(true)}
        onDismiss={() => setShown(false)}
      />
      {acted ? <p className="m-0 text-body-sm text-fg-dim">Action pressed</p> : null}
    </div>
  );
}

function ValidationForm() {
  const error = errorFor("validation");
  const fields = fieldErrorsByName(error);
  return (
    <div className="grid w-96 gap-5">
      <Banner tone="bad" inline>
        {describeApiError(error).message}
      </Banner>
      <FormField label="Task name" required error={fields.name}>
        <TextFieldInput defaultValue="" />
      </FormField>
      <FormField label="Due date" required error={fields.due_date}>
        <TextFieldInput defaultValue="12 Oct 2026" />
      </FormField>
    </div>
  );
}

const meta = {
  title: "Components/Error toasts",
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

export const BadRequest: Story = { render: () => <KindToast kind="bad-request" /> };
export const Unauthenticated: Story = { render: () => <KindToast kind="unauthenticated" /> };
export const Forbidden: Story = { render: () => <KindToast kind="forbidden" /> };
export const NotFound: Story = { render: () => <KindToast kind="not-found" /> };
export const Conflict: Story = { render: () => <KindToast kind="conflict" /> };
export const Validation: Story = { render: () => <KindToast kind="validation" /> };
export const Server: Story = { render: () => <KindToast kind="server" /> };
export const Network: Story = { render: () => <KindToast kind="network" /> };
export const ValidationInline: Story = { render: () => <ValidationForm /> };
