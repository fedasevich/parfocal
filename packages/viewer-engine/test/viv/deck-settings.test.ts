import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deckDeviceProps,
  installUint8TextureUpload,
  stableSelections,
  uint8TextureFormat,
  unpickableLayerProps,
} from "../../src/viv/deck-settings.ts";

test("decks are created without multisampling and layers without picking", () => {
  assert.deepEqual(deckDeviceProps, { type: "webgl", webgl: { antialias: false } });
  assert.deepEqual(unpickableLayerProps, { pickable: false });
});

test("a slide keeps one selections array for the same channels", () => {
  const slide = {};
  const first = stableSelections(slide, [{ c: 0 }, { c: 1 }]);
  const again = stableSelections(slide, [{ c: 0 }, { c: 1 }]);
  assert.equal(again, first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0]));
  assert.notEqual(stableSelections(slide, [{ c: 1 }]), first);
  assert.notEqual(stableSelections({}, [{ c: 0 }, { c: 1 }]), first);
});

const stockHook = "intensity = apply_contrast_limits(intensity, contrastLimits);";

interface FakeLayerProps {
  dtype: string;
  interpolation: string;
}

function fakeLayerClass() {
  const textures: Record<string, unknown>[] = [];
  class FakeChannelLayer {
    props: FakeLayerProps;
    hookedByExtension = false;
    context = {
      device: {
        createTexture: (props: Record<string, unknown>) => {
          textures.push(props);
          return { props: { ...props } };
        },
      },
    };

    constructor(props: FakeLayerProps) {
      this.props = props;
    }

    _isHookDefinedByExtensions() {
      return this.hookedByExtension;
    }

    getShaders(): { defines: Record<string, unknown>; modules: unknown[] } {
      return {
        defines: { SAMPLER_TYPE: "usampler2D" },
        modules: ["project32", { inject: { "fs:DECKGL_PROCESS_INTENSITY": `\n${stockHook}\n` } }],
      };
    }

    dataToTexture(_data: unknown, width: number, height: number) {
      return this.context.device.createTexture({ width, height, format: "r8uint" });
    }
  }
  return { FakeChannelLayer, textures };
}

test("uint8 channels upload as r8unorm with a float sampler and rescaled intensity", () => {
  const { FakeChannelLayer, textures } = fakeLayerClass();
  installUint8TextureUpload(FakeChannelLayer);
  installUint8TextureUpload(FakeChannelLayer);
  const layer = new FakeChannelLayer({ dtype: "Uint8", interpolation: "linear" });
  const shaders = layer.getShaders();
  assert.equal(shaders.defines.SAMPLER_TYPE, "sampler2D");
  assert.equal(shaders.modules[0], "project32");
  assert.match(
    JSON.stringify(shaders.modules[1]),
    /apply_contrast_limits\(intensity \* 255\.0, contrastLimits\)/,
  );
  const texture = layer.dataToTexture(new Uint8Array(4), 2, 2);
  assert.equal(textures.length, 1);
  assert.equal(textures[0]?.format, uint8TextureFormat);
  assert.deepEqual(textures[0]?.sampler, {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  assert.equal(texture.props.data, undefined);
});

test("other dtypes and layers whose extensions own the intensity hook keep Viv's upload", () => {
  const { FakeChannelLayer, textures } = fakeLayerClass();
  installUint8TextureUpload(FakeChannelLayer);
  const wide = new FakeChannelLayer({ dtype: "Uint16", interpolation: "nearest" });
  assert.equal(wide.getShaders().defines.SAMPLER_TYPE, "usampler2D");
  wide.dataToTexture(new Uint16Array(4), 2, 2);
  const hooked = new FakeChannelLayer({ dtype: "Uint8", interpolation: "nearest" });
  hooked.hookedByExtension = true;
  assert.equal(hooked.getShaders().defines.SAMPLER_TYPE, "usampler2D");
  hooked.dataToTexture(new Uint8Array(4), 2, 2);
  assert.deepEqual(
    textures.map((texture) => texture.format),
    ["r8uint", "r8uint"],
  );
});

test("a changed Viv intensity hook is refused instead of drawing wrong intensities", () => {
  const { FakeChannelLayer } = fakeLayerClass();
  FakeChannelLayer.prototype.getShaders = () => ({
    defines: {},
    modules: [{ inject: { "fs:DECKGL_PROCESS_INTENSITY": "intensity = remap(intensity);" } }],
  });
  installUint8TextureUpload(FakeChannelLayer);
  const layer = new FakeChannelLayer({ dtype: "Uint8", interpolation: "nearest" });
  assert.throws(() => layer.getShaders(), /intensity hook changed/);
});
