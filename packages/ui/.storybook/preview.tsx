import "../src/styles/globals.css";
import { fakeApiHandlers } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import { TooltipProvider } from "../src/components/tooltip.tsx";
import { StoryI18n } from "./story-i18n.tsx";

const preview: Preview = {
  loaders: [mswLoader(() => startFakeWorker(fakeApiHandlers("all")))],
  decorators: [
    withThemeByDataAttribute({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
    (Story) => (
      <StoryI18n>
        <TooltipProvider>
          <Story />
        </TooltipProvider>
      </StoryI18n>
    ),
  ],
  parameters: {
    layout: "padded",
    a11y: { test: "error" },
  },
};

export default preview;
