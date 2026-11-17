import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadParityFiles, parityDownloads, parityGraphs } from "../../sam-bench/parity-files.ts";

const files = loadParityFiles();
const urlFor = (key: string) => `https://mirror.test/${key}`;

describe("browser parity files in R2", () => {
  it("lists every graph each provider runs and the fixture manifest", () => {
    for (const provider of ["webgpu", "wasm"] as const) {
      for (const graph of parityGraphs(provider)) {
        assert.ok(
          files.models.some((m) => m.file === graph),
          graph,
        );
      }
    }
    assert.ok(files.dataset.some((d) => d.file === "manifest.json"));
    for (const entry of [...files.models, ...files.dataset]) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.ok(entry.bytes > 0);
    }
  });

  it("fetches only the WebAssembly graphs for a WebAssembly run", () => {
    const downloads = parityDownloads(files, ["wasm"], urlFor);
    const models = downloads.filter((d) => d.into === "models").map((d) => d.fixture.file);
    assert.deepEqual(models.sort(), [...parityGraphs("wasm")].sort());
    assert.ok(!models.includes("pathosam.encoder_q4.onnx"));
    assert.equal(downloads.filter((d) => d.into === "dataset").length, files.dataset.length);
  });

  it("reads graphs and fixture from their own keys under the parity prefix", () => {
    const [graph] = parityDownloads(files, ["wasm"], urlFor);
    assert.ok(graph);
    assert.equal(graph.key, `sam-parity/onnx/${graph.fixture.file}`);
    assert.equal(graph.fixture.url, `https://mirror.test/sam-parity/onnx/${graph.fixture.file}`);
    const manifest = parityDownloads(files, ["wasm"], urlFor).find(
      (d) => d.fixture.file === "manifest.json",
    );
    assert.equal(manifest?.key, "sam-parity/dataset/manifest.json");
  });

  it("refuses a list that lacks a graph the provider runs", () => {
    const lacking = { ...files, models: files.models.slice(1) };
    assert.throws(() => parityDownloads(lacking, ["webgpu", "wasm"], urlFor), /lacks/);
  });
});
