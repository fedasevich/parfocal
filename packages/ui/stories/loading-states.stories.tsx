import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowPageSkeleton } from "../src/components/flow-page.tsx";
import { SkeletonRows } from "../src/components/skeleton.tsx";
import {
  SkeletonBanner,
  SkeletonFormZone,
  SkeletonSheet,
  SkeletonZone,
  SkeletonZones,
} from "../src/components/skeleton-layouts.tsx";
import { TopProgress } from "../src/components/top-progress.tsx";

const meta = {
  title: "Feedback/Loading states",
  component: SkeletonRows,
  parameters: { layout: "padded" },
  args: { label: "Loading slides" },
} satisfies Meta<typeof SkeletonRows>;

export default meta;

type Story = StoryObj<typeof meta>;

function Page({ theme, dimmed }: { theme?: "light" | "dark"; dimmed: boolean }) {
  return (
    <div data-theme={theme} className="relative grid gap-4 bg-surf-page p-6 text-fg">
      <TopProgress active label="Loading the page" className="absolute" />
      <div
        aria-busy={dimmed}
        className="grid gap-4 transition-opacity data-[dimmed=true]:opacity-60"
        data-dimmed={dimmed}
      >
        <h3 className="m-0 text-page-title font-semibold">Slides</h3>
        <div className="rounded-zone border border-line bg-surf-panel">
          <SkeletonRows label="Loading slides" rows={6} columns={4} />
        </div>
      </div>
    </div>
  );
}

export const TableRows: Story = {
  render: (args) => (
    <div className="rounded-zone border border-line bg-surf-panel">
      <SkeletonRows {...args} rows={6} columns={4} />
    </div>
  ),
};

export const ListRows: Story = {
  render: (args) => (
    <div className="max-w-sm rounded-zone border border-line bg-chrome">
      <SkeletonRows {...args} label="Loading tasks" rows={3} columns={1} />
    </div>
  ),
};

export const PageLoading: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <Page dimmed={false} />,
};

export const RouteChangeDark: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <Page theme="dark" dimmed />,
};

export const ReportPage: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <FlowPageSkeleton className="h-dvh" label="Loading the clinical report">
      <SkeletonBanner />
      <SkeletonSheet />
    </FlowPageSkeleton>
  ),
};

export const FormPage: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <FlowPageSkeleton className="h-dvh" label="Loading the new review task" steps={6}>
      <SkeletonZone fields={1} />
      <SkeletonZone fields={3} />
      <SkeletonZone fields={2} />
    </FlowPageSkeleton>
  ),
};

export const AdminForm: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4">
      <SkeletonFormZone label="Loading retention" rows={4} />
      <SkeletonZones label="Loading the overview" stats count={2} />
    </div>
  ),
};
