import type { Plugin } from "vite";

export const publicEnvPrefix = "PARFOCAL_PUBLIC_";

const builtInNames = new Set(["MODE", "DEV", "PROD", "SSR", "BASE_URL"]);
const namedReference = /import\.meta\.env\.([A-Za-z_$][\w$]*)/g;
const wholeObjectReference = /import\.meta\.env(?!\.[A-Za-z_$])/;

function isApplicationModule(id: string): boolean {
  return !id.startsWith("\0") && !id.includes("/node_modules/") && !id.includes("/@vite/");
}

export function forbiddenEnvNames(code: string, prefix = publicEnvPrefix): string[] {
  const names = [...code.matchAll(namedReference)]
    .map((match) => match[1] ?? "")
    .filter((name) => !builtInNames.has(name) && !name.startsWith(prefix));
  return [...new Set(names)];
}

export function publicEnvOnly(prefix = publicEnvPrefix): Plugin {
  return {
    name: "parfocal:public-env-only",
    enforce: "pre",
    transform(code, id) {
      if (!isApplicationModule(id) || !code.includes("import.meta.env")) return null;
      const forbidden = forbiddenEnvNames(code, prefix);
      if (forbidden.length > 0) {
        this.error(
          `${id} reads ${forbidden.join(", ")} from import.meta.env. Only ${prefix}* variables may reach the browser.`,
        );
      }
      if (wholeObjectReference.test(code)) {
        this.error(
          `${id} reads import.meta.env as a whole. Name each ${prefix}* variable, such as import.meta.env.${prefix}APP_ENV.`,
        );
      }
      return null;
    },
  };
}
