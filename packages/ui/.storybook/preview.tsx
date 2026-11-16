import "../src/styles/globals.css";
import { fakeApiHandlers } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import { TooltipProvider } from "../src/components/tooltip.tsx";
import { StoryI18n } from "./story-i18n.tsx";

const withDensity: Decorator = (Story, context) => {
  const density: unknown = context.globals["density"];
  if (density === "compact" || density === "comfortable") {
    document.documentElement.setAttribute("data-density", density);
  } else {
    document.documentElement.removeAttribute("data-density");
  }
  return <Story />;
};

const preview: Preview = {
  globalTypes: {
    density: {
      description: "Spacing density",
      toolbar: {
        title: "Density",
        icon: "component",
        items: ["comfortable", "compact"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { density: "comfortable" },
  loaders: [mswLoader(() => startFakeWorker(fakeApiHandlers("all")))],
  decorators: [
    withThemeByDataAttribute({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
    withDensity,
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
