import "../src/styles/globals.css";
import { fakeApiHandlers } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import { TooltipProvider } from "../src/components/tooltip.tsx";

const preview: Preview = {
  loaders: [mswLoader(() => startFakeWorker(fakeApiHandlers("all")))],
  decorators: [
    withThemeByDataAttribute({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: "padded",
    a11y: { test: "error" },
  },
};

export default preview;
