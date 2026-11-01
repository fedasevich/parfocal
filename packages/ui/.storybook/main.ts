import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../stories/**/*.stories.tsx"],
  staticDirs: [{ from: "../../../docs/design/ux-mock/assets", to: "/mock-assets" }],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
};

export default config;
