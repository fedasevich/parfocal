import { existsSync, readFileSync } from "node:fs";

interface MatrixTest {
  readonly title: string;
  readonly results: readonly {
    readonly status: string;
    readonly annotations?: readonly { type: string; description?: string }[];
  }[];
  readonly projectName: string;
}

interface MatrixSuite {
  readonly suites?: readonly MatrixSuite[];
  readonly specs?: readonly { title: string; tests: readonly MatrixTest[] }[];
}

export interface MatrixCell {
  readonly project: string;
  readonly title: string;
  readonly status: string;
  readonly support: string;
}

export function cellsOf(report: MatrixSuite): MatrixCell[] {
  const cells: MatrixCell[] = [];
  const visit = (suite: MatrixSuite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const last = test.results.at(-1);
        cells.push({
          project: test.projectName,
          title: spec.title,
          status: last?.status ?? "skipped",
          support:
            last?.annotations?.find((annotation) => annotation.type === "support")?.description ??
            "",
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
  return cells;
}

export function matrixMarkdown(cells: readonly MatrixCell[]): string {
  if (cells.length === 0) return "## Cross-browser viewer matrix\n\nNo results were written.\n";
  const projects = [...new Set(cells.map((cell) => cell.project))];
  const titles = [...new Set(cells.map((cell) => cell.title))];
  const mark = (status: string) => (status === "passed" ? "pass" : status);
  const lines = [
    "## Cross-browser viewer matrix",
    "",
    `| Check | ${projects.join(" | ")} |`,
    `| --- | ${projects.map(() => "---").join(" | ")} |`,
    ...titles.map((title) => {
      const row = projects.map((project) => {
        const cell = cells.find((found) => found.project === project && found.title === title);
        return cell === undefined ? "none" : mark(cell.status);
      });
      return `| ${title} | ${row.join(" | ")} |`;
    }),
    "",
    "### Browser support",
    "",
  ];
  for (const cell of cells.filter((found) => found.support !== "")) {
    lines.push(`- ${cell.project}: \`${cell.support}\``);
  }
  return `${lines.join("\n")}\n`;
}

const file = process.argv[2];
if (file !== undefined && import.meta.main) {
  process.stdout.write(
    matrixMarkdown(
      existsSync(file) ? cellsOf(JSON.parse(readFileSync(file, "utf8")) as MatrixSuite) : [],
    ),
  );
}
