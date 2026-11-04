import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { CommentMessage } from "../src/components/comment-thread.tsx";
import { ThreadPopover } from "../src/components/thread-popover.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Thread popover",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const opening: CommentMessage[] = [
  {
    id: "m1",
    author: people.LM,
    at: "25 min ago",
    text: "Does the boundary run past the capsule fold?",
  },
  {
    id: "m2",
    author: people.DH,
    researcher: true,
    at: "4 min ago",
    text: "I think so on the left. @Lenka Malá can you check at 40x?",
  },
];

const measurement = {
  label: "Tumor region",
  values: [
    { name: "Area", value: "1.82 mm²" },
    { name: "Perimeter", value: "5.40 mm" },
  ],
};

function Frame({
  resolvedAtStart = false,
  withMeasurement = true,
}: {
  resolvedAtStart?: boolean;
  withMeasurement?: boolean;
}) {
  const [resolved, setResolved] = useState(resolvedAtStart);
  const [reply, setReply] = useState("");
  const [thread, setThread] = useState(opening);
  const [open, setOpen] = useState(true);
  if (!open) return <p>Closed</p>;
  return (
    <ThreadPopover
      title="Does the boundary run past the capsule fold?"
      resolved={resolved}
      messages={thread}
      measurement={withMeasurement ? measurement : undefined}
      reply={reply}
      onReplyChange={setReply}
      onSend={() => {
        setThread([
          ...thread,
          {
            id: `m${thread.length + 1}`,
            author: people.LM,
            you: true,
            at: "just now",
            text: reply,
          },
        ]);
        setReply("");
      }}
      onToggleResolved={() => setResolved(!resolved)}
      onClose={() => setOpen(false)}
    />
  );
}

export const OpenThread: Story = { render: () => <Frame /> };

export const ResolvedThread: Story = { render: () => <Frame resolvedAtStart /> };

export const WithoutMeasurement: Story = { render: () => <Frame withMeasurement={false} /> };
