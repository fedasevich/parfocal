import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/tabs.tsx";

const meta = {
  title: "Controls/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example({ variant }: { variant: "default" | "line" }) {
  return (
    <Tabs defaultValue="cells" className="w-80">
      <TabsList variant={variant}>
        <TabsTrigger value="cells">Cells</TabsTrigger>
        <TabsTrigger value="regions">Regions</TabsTrigger>
        <TabsTrigger value="notes" disabled>
          Notes
        </TabsTrigger>
      </TabsList>
      <TabsContent value="cells" className="text-sm">
        1,204 cells in view.
      </TabsContent>
      <TabsContent value="regions" className="text-sm">
        3 regions in view.
      </TabsContent>
    </Tabs>
  );
}

export const Default: Story = {
  render: () => <Example variant="default" />,
};

export const Line: Story = {
  render: () => <Example variant="line" />,
};
