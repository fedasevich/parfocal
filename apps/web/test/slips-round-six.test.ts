import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceName } from "../src/screens/settings/device-name.ts";
import { resultSetNote } from "../src/screens/viewer/result-set-name.ts";

test("a result set note never repeats the version in its name", () => {
  assert.equal(resultSetNote("PathoSAM + HoVer-NeXt v1.2", "v1.2", null), null);
  assert.equal(resultSetNote("PathoSAM + HoVer-NeXt", "v1.2", null), "v1.2");
  assert.equal(resultSetNote("Imported cells", null, "cells.geojson"), "cells.geojson");
  assert.equal(resultSetNote("Imported cells", null, null), null);
});

test("a device is named in words, not by its raw user agent", () => {
  assert.equal(
    deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    ),
    "Chrome on Mac",
  );
  assert.equal(
    deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    "Firefox on Windows",
  );
  assert.equal(deviceName("parfocal-agent-session"), "unnamed client");
  assert.equal(deviceName(null), "unknown device");
});
