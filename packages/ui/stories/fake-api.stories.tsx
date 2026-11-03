import { useGetMe, useListMyJobs } from "@parfocal/api-client";
import { getGetMeMockHandler } from "@parfocal/api-client/fake";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function SignedInAs() {
  const me = useGetMe();
  const jobs = useListMyJobs();
  if (me.data?.status !== 200) return <p className="text-fg-dim text-body">Loading…</p>;
  return (
    <div className="flex flex-col gap-1 text-body">
      <p className="text-fg" data-testid="signed-in-as">
        {me.data.data.display_name}
      </p>
      <p className="text-fg-dim">{me.data.data.title}</p>
      <p className="text-fg-dim" data-testid="job-count">
        {jobs.data?.data.length ?? 0} jobs
      </p>
    </div>
  );
}

const meta = {
  title: "Fake data/Signed in person",
  component: SignedInAs,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof SignedInAs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FromTheScenario: Story = {};

export const WithAnOverride: Story = {
  parameters: {
    msw: [
      getGetMeMockHandler({
        user_id: "00000000-0000-4000-8001-000000000009",
        display_name: "Daniel Hruška",
        initials: "DH",
        avatar_colour: 8,
        title: "Researcher · AI evaluation",
        email: null,
        active_tenant_id: null,
        workspaces: [],
      }),
    ],
  },
};
