import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DataFilterExtension, PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import {
  WgslDashExtension,
  wgslDashExtensionFor,
  wgslDashInjections,
} from "../../src/deck-webgpu/wgsl-dash-extension.ts";

interface AssembledShaders {
  readonly source: string;
  readonly inject: Record<string, string>;
  readonly defines: Record<string, unknown>;
  readonly modules: readonly { readonly name: string; readonly source?: string }[];
}

function pathShaders(
  extension: PathStyleExtension,
  device: "webgpu" | "webgl",
  antialiasing = false,
): AssembledShaders {
  const layer = {
    props: { antialiasing, extensions: [extension] },
    context: { device: { type: device }, defaultShaderModules: [] },
    state: { pathTesselator: {} },
  };
  return (PathLayer.prototype.getShaders as (this: unknown) => AssembledShaders).call(layer);
}

describe("dashes in WGSL for the deck.gl WebGPU route", () => {
  it("turns a dashing PathStyleExtension into its WGSL twin once", () => {
    const dashes = new PathStyleExtension({ dash: true, dashMode: "path" });
    const twin = wgslDashExtensionFor(dashes);
    assert.ok(twin instanceof WgslDashExtension);
    assert.equal(twin.opts.dashMode, "path");
    assert.equal(wgslDashExtensionFor(dashes), twin);
    assert.equal(wgslDashExtensionFor(twin), twin);
  });

  it("leaves out an offset extension and any other extension", () => {
    assert.equal(wgslDashExtensionFor(new PathStyleExtension({ dash: true, offset: true })), null);
    assert.equal(wgslDashExtensionFor(new DataFilterExtension()), null);
  });

  it("anchors every injection on text the installed PathLayer WGSL holds", () => {
    for (const antialiasing of [false, true]) {
      for (const dashMode of ["path", "segment"] as const) {
        const twin = wgslDashExtensionFor(new PathStyleExtension({ dash: true, dashMode }));
        assert.ok(twin);
        const shaders = pathShaders(twin, "webgpu", antialiasing);
        assert.equal(shaders.defines["DASH_ENABLED"], true);
        assert.equal(
          shaders.defines["HIGH_PRECISION_DASH"],
          dashMode === "path" ? true : undefined,
        );
        const anchors = Object.keys(shaders.inject).filter((key) => !key.startsWith("fs:#"));
        assert.equal(anchors.length, 4);
        for (const anchor of anchors) {
          assert.ok(shaders.source.includes(anchor), `missing anchor ${JSON.stringify(anchor)}`);
        }
        const pathStyle = shaders.modules.find((module) => module.name === "pathStyle");
        assert.match(pathStyle?.source ?? "", /var<uniform> pathStyle: PathStyleUniforms/);
      }
    }
  });

  it("reads the phase attribute only in path mode and the feathered colour only when antialiased", () => {
    const joined = (options: { pathPhase: boolean; antialiasing: boolean }) =>
      Object.values(wgslDashInjections(options)).join("\n");
    assert.match(joined({ pathPhase: true, antialiasing: false }), /instanceDashOffsets/);
    assert.doesNotMatch(joined({ pathPhase: false, antialiasing: false }), /instanceDashOffsets/);
    assert.match(
      joined({ pathPhase: true, antialiasing: false }),
      /varyings\.vColor\.a \* dashCoverage/,
    );
    assert.match(joined({ pathPhase: true, antialiasing: true }), /color\.a \* dashCoverage/);
    assert.doesNotMatch(joined({ pathPhase: true, antialiasing: false }), /#ifdef/);
  });

  it("keeps deck.gl's GLSL on a WebGL device", () => {
    const twin = wgslDashExtensionFor(new PathStyleExtension({ dash: true, dashMode: "path" }));
    assert.ok(twin);
    const shaders = pathShaders(twin, "webgl");
    const pathStyle = shaders.modules.find((module) => module.name === "pathStyle");
    assert.equal(pathStyle?.source, undefined);
    assert.ok("fs:#main-end" in ((pathStyle as { inject?: object } | undefined)?.inject ?? {}));
  });
});
