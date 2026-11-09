# XXXX. Input devices are read natively where the browser allows it and always have a mouse and keyboard fallback

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: DEV-000 (input devices research check). Lists browser support and fallbacks for the devices that DEV-002 (trackpad gestures), DEV-003 (gamepad), DEV-004 (SpaceMouse over WebHID) and DEV-009 (pen and touch separation) still build

## Context

The device kit promises mouse, trackpad, touch, pen, gamepad, SpaceMouse and keyboard, with a footswitch as a keyboard key. DEV-000 asked for browser support and fallbacks to be written down before the gamepad and SpaceMouse work starts. Every device already maps to semantic intents (pan vector, zoom delta, next cell, keep, peek) in `apps/web/src/devices/intents.ts`, with calibration (speed and dead zone) from DEV-005 and the viewer reading those intents since DEV-012 (devices drive the viewer through intents). A new device only has to produce raw input for that mapper.

The browser support below comes from the public MDN and Chrome documentation as known at the time of writing and was not re-measured on hardware. Rows marked TODO need a check on the real device when the owning task runs.

## Decision

Input is read only through standard browser APIs, and no device is required for any workflow. Every device-only action also has a keyboard or pointer path. A device that the browser cannot reach simply does not appear in Settings and the legend shows it as unavailable instead of failing.

- Mouse is built. Wheel zoom, middle-drag and Space+drag pan, double-click zoom and the wheel classifier live in `packages/viewer-engine/src/input/wheel.ts` (VIEW-021, wheel, trackpad and pinch handling). Support is every browser. There is no fallback to give, since the mouse is the baseline.
- Trackpad is built for wheel events. A pinch arrives as a wheel event with ctrlKey set and a small fractional delta, and a two-finger scroll arrives as a pixel-mode wheel event with both axes. The classifier tells it from a mouse wheel by delta shape, treats the macOS mouse step 4.000244140625 as a mouse, and caps each event at half an octave. Support is every desktop browser. Safari also fires its own `gesturestart` events for pinch, which the engine ignores because the wheel path already covers it. The fallback is the wheel mode setting, which forces zoom or pan when auto detection guesses wrong. DEV-002 adds replayed macOS and Windows traces, the two-finger click for a negative point and the rule that drag-to-pan is never required.
- Touch is built in `packages/viewer-engine/src/input/touch.ts` with pointer events: tap slop 10 px, tap time 300 ms, double-tap window 350 ms and magnification 40x on double tap. Support is every browser on iOS, Android and touch laptops. Two-finger pan and pinch use the same pointer stream. The fallback is the on-screen zoom and fit buttons in the dock, which the tablet layout (DEV-008) sizes to 56 px targets. DEV-009 keeps a finger from ever drawing in Annotate.
- Pen is built for the double-tap and legend mappings through pointer events (`pointerType` is "pen"). Support is every browser that has pointer events, which is all current ones. Pressure, tilt and the barrel button are read from the same events, but eraser end and barrel button codes differ by tablet driver, so TODO check them on a real Wacom or Apple Pencil in DEV-009. The fallback is that a pen behaves as a mouse with the active tool. DEV-009 adds palm rejection by pointer type, double tap to the last tool and the side button as erase.
- Keyboard is built and is the guaranteed fallback for everything. Review keys J, K, X and 1 to 4, arrow keys for pan with Shift for 3x, plus and minus for half an octave, brackets for areas and Z for peek are in `intents.ts`. A footswitch that sends a key maps to next cell by default (DEV-007) and needs no API. Support is every browser.
- Gamepad is not built yet and is added by DEV-003. The Gamepad API is available in Chrome, Edge, Firefox and Safari on desktop, and in Chrome and Safari on Android and iOS for pads that the OS exposes. A pad stays hidden until the user presses a button, so the page cannot see it on load, and it has no permission prompt. The page must be a secure context and the Permissions-Policy `gamepad` feature must not be blocked. Pads are read by polling `navigator.getGamepads()` once per animation frame, only while the viewer is open and the tab is focused, so an idle viewer asks for no extra frames. The standard mapping is assumed (`mapping === "standard"`), and a pad with another mapping is ignored with a hint to use the keyboard. Raw axes go through `applyDeadZone` and the per-device speed from calibration. Fallback is the keyboard and mouse path for each action.
- SpaceMouse over WebHID is not built yet and is added by DEV-004. WebHID is available in Chrome and Edge 89 and later on desktop (Windows, macOS, Linux, ChromeOS). It is not available in Firefox or Safari, and not in Chrome on Android or iOS. It needs a secure context, a user gesture for `navigator.hid.requestDevice`, and the Permissions-Policy `hid` feature. The user grants one device through the browser chooser, and the grant is remembered for the origin so later visits use `navigator.hid.getDevices()` without a prompt. Where `navigator.hid` does not exist the Settings device row says the SpaceMouse needs Chrome or Edge and the viewer keeps working with the mouse.
- The SpaceMouse reports follow the community documented 3Dconnexion layout, TODO confirm against recorded reports in DEV-004. 3Dconnexion devices use vendor id 0x256f (older ones 0x046d) and the multi-axis controller usage (usage page 0x01, usage 0x08). Report id 1 carries translation as three signed 16-bit little-endian values (x, y, z), report id 2 carries rotation (rx, ry, rz) and report id 3 carries a button bitmask. Values are roughly plus or minus 350 for older models and up to about 500 for newer ones, so the mapper normalises by the largest value seen and by the calibration dead zone. Tilt pans, push and pull zooms, and a full pull maps to peek at the existing `peekPullThreshold` of 0.95. Rotation stays off by default.
- On macOS and Windows the 3Dconnexion driver may already hold the device. If `device.open()` fails, DEV-004 shows a plain message that the driver has the device, and the fallback is the driver's own keyboard and mouse emulation, which already works through the paths above.

## Alternatives considered

- Require the 3Dconnexion driver or a native bridge. This would reach Firefox and Safari but needs an install, which the platform avoids for a browser-only product.
- Use the Gamepad API for the SpaceMouse. The SpaceMouse does not show up as a standard gamepad on most systems, and where it does the axes are mixed up, so WebHID is the reliable route.
- Poll devices all the time. This wastes battery on tablets, so polling runs only while the viewer is open and focused.

## Consequences

- The gamepad works in every desktop browser with no setup. The SpaceMouse is a Chrome and Edge desktop feature, and this is stated in Settings.
- DEV-003 and DEV-004 each add recorded or simulated input tests and no new mapping code outside `intents.ts`.
- Nothing is lost for a user without these devices, since keyboard and pointer reach every action.
- Open checks with hardware: Safari pinch behaviour on a real trackpad (DEV-002), pen eraser and barrel codes (DEV-009), SpaceMouse report ranges and driver conflicts (DEV-004).
