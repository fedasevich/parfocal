import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  graphRunsOn,
  type SamProvider,
  samGraphs,
  samProvider,
  samVariant,
} from "../../src/index.ts";

const providers: readonly SamProvider[] = ["webgpu", "wasm"];

describe("PathoSAM variants per execution provider", () => {
  it("gives WebGPU the 4-bit encoder and WebAssembly the uint8 encoder", () => {
    assert.equal(samVariant("webgpu").encoder, samGraphs.encoderQ4);
    assert.equal(samVariant("wasm").encoder, samGraphs.encoderUint8);
  });

  it("never hands WebGPU a dynamic uint8 graph", () => {
    assert.equal(graphRunsOn(samGraphs.encoderUint8, "webgpu"), false);
    assert.equal(graphRunsOn(samGraphs.aisDecoderUint8, "webgpu"), false);
    const webgpu = samVariant("webgpu");
    for (const graph of [webgpu.encoder, webgpu.decoder, webgpu.aisDecoder]) {
      assert.equal(graphRunsOn(graph, "webgpu"), true, graph);
    }
  });

  it("shares one decoder and one AIS decoder across providers and loads no fp16 graph", () => {
    assert.equal(samVariant("webgpu").decoder, samVariant("wasm").decoder);
    assert.equal(samVariant("webgpu").aisDecoder, samVariant("wasm").aisDecoder);
    for (const provider of providers) {
      const variant = samVariant(provider);
      assert.equal(variant.provider, provider);
      for (const graph of [variant.encoder, variant.decoder, variant.aisDecoder]) {
        assert.doesNotMatch(graph, /fp16/);
      }
    }
  });

  it("picks WebGPU only with an adapter", () => {
    assert.equal(samProvider(true), "webgpu");
    assert.equal(samProvider(false), "wasm");
  });
});
