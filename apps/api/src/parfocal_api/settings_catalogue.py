import json
import sys
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, cast

TS_PATH = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "api-client"
    / "src"
    / "settings"
    / "catalogue.generated.ts"
)


class Layer(StrEnum):
    LAB = "lab"
    PERSONAL = "personal"
    DEVICE = "device"


class Kind(StrEnum):
    CHOICE = "choice"
    SWITCH = "switch"
    WHOLE = "whole"
    ID = "id"
    NAMES = "names"
    KEYS = "keys"


LAB = frozenset({Layer.LAB})
PERSONAL = frozenset({Layer.PERSONAL})
DEVICE = frozenset({Layer.DEVICE})
LAB_OR_PERSONAL = frozenset({Layer.LAB, Layer.PERSONAL})


@dataclass(frozen=True)
class Setting:
    key: str
    kind: Kind
    default: str | bool | int | tuple[str, ...] | Mapping[str, tuple[str, ...]]
    layers: frozenset[Layer]
    options: tuple[str, ...] = ()
    minimum: int | None = None
    maximum: int | None = None

    def problem(self, value: object) -> str | None:
        match self.kind:
            case Kind.CHOICE:
                if value not in self.options:
                    return f"is one of {', '.join(self.options)}"
            case Kind.SWITCH:
                if not isinstance(value, bool):
                    return "is on or off"
            case Kind.WHOLE:
                if isinstance(value, bool) or not isinstance(value, int):
                    return "is a whole number"
                if self.minimum is not None and value < self.minimum:
                    return f"is at least {self.minimum}"
                if self.maximum is not None and value > self.maximum:
                    return f"is at most {self.maximum}"
            case Kind.ID:
                try:
                    uuid.UUID(value if isinstance(value, str) else "")
                except ValueError:
                    return "is an identifier"
            case Kind.NAMES:
                if not names_fit(value, self.maximum or 0):
                    return f"is a list of at most {self.maximum} short names"
            case Kind.KEYS:
                if not isinstance(value, dict):
                    return f"maps at most {MAX_BINDINGS} actions to their keys"
                bindings = cast(dict[object, object], value)
                if len(bindings) > MAX_BINDINGS:
                    return f"maps at most {MAX_BINDINGS} actions to their keys"
                if not all(names_fit(keys, MAX_KEYS_PER_ACTION) for keys in bindings.values()):
                    return f"gives each action at most {MAX_KEYS_PER_ACTION} keys"
                if not all(names_fit([action], 1) for action in bindings):
                    return "names each action"
        return None


MAX_NAME = 60
MAX_BINDINGS = 200
MAX_KEYS_PER_ACTION = 4


def names_fit(value: object, most: int) -> bool:
    if not isinstance(value, list):
        return False
    names = cast(list[object], value)
    return len(names) <= most and all(
        isinstance(name, str) and 0 < len(name) <= MAX_NAME for name in names
    )


def choice(key: str, default: str, options: tuple[str, ...], layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.CHOICE, default, layers, options=options)


def switch(key: str, default: bool, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.SWITCH, default, layers)


def whole(key: str, default: int, low: int, high: int, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.WHOLE, default, layers, minimum=low, maximum=high)


def identifier(key: str, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.ID, "", layers)


def names(key: str, most: int, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.NAMES, (), layers, maximum=most)


def keys(key: str, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.KEYS, {}, layers)


CATALOGUE: tuple[Setting, ...] = (
    choice("theme", "system", ("system", "light", "dark"), DEVICE),
    whole("slide_brightness", 100, 20, 140, DEVICE),
    choice("density", "comfortable", ("comfortable", "compact"), PERSONAL),
    choice("patient_names", "full", ("full", "initials"), LAB_OR_PERSONAL),
    choice("length_unit", "auto", ("auto", "um"), PERSONAL),
    choice("language", "en", ("en", "cs"), PERSONAL),
    choice("magnification_label", "objective", ("objective", "microns-per-pixel"), PERSONAL),
    choice("tools", "rail", ("rail", "dock"), PERSONAL),
    whole("side_panel_width", 340, 240, 560, PERSONAL),
    switch("hide_side_panel", False, PERSONAL),
    choice("panel_while_moving", "pinned", ("pinned", "auto"), PERSONAL),
    choice("minimap", "useful", ("useful", "always", "never"), PERSONAL),
    switch("slide_strip", False, PERSONAL),
    choice(
        "confidence_wording",
        "words",
        ("words", "numbers", "frequency", "colour", "hidden"),
        PERSONAL,
    ),
    choice("outline_mode", "fade", ("fade", "mark-unsure", "bands"), PERSONAL),
    choice("tier_outline", "best", ("best", "good", "fast"), PERSONAL),
    switch("inspector_track_record", True, PERSONAL),
    switch("inspector_calibration", True, PERSONAL),
    whole("decision_cutoff", 50, 0, 100, LAB),
    choice("wheel_mode", "zoom", ("zoom", "pan"), DEVICE),
    switch("invert_zoom", False, DEVICE),
    choice("camera_feel", "smooth", ("smooth", "precise", "instant"), DEVICE),
    switch("notify_ai_finished", True, PERSONAL),
    switch("notify_replies", True, PERSONAL),
    switch("initials_while_sharing", True, PERSONAL),
    choice("analytics_policy", "person", ("person", "on", "off"), LAB),
    switch("analytics_opt_out", False, PERSONAL),
    whole("lock_after_minutes", 15, 1, 240, LAB),
    switch("patient_banner", True, LAB),
    choice("default_privacy_mode", "de-identified", ("de-identified", "clinical"), LAB),
    choice("default_classes", "none", ("none", "sentinel-node", "pannuke"), LAB),
    identifier("default_study_template", LAB),
    whole("tumor_share_cutoff", 20, 1, 99, LAB),
    switch("tumor_share_result_sentinel_node", False, LAB),
    switch("tumor_share_result_pannuke", True, LAB),
    whole("unsure_zone_square_px", 128, 16, 1024, LAB),
    whole("unsure_zone_min_nuclei", 3, 1, 100, LAB),
    whole("unsure_zone_min_unsure_percent", 30, 1, 100, LAB),
    whole("unsure_zone_min_unsure_cells", 4, 1, 1000, LAB),
    choice("home_layout", "role", ("role", "review", "research", "both"), PERSONAL),
    switch("getting_started_hidden", False, PERSONAL),
    names("presets", 3, PERSONAL),
    whole("default_preset", 0, 0, 3, PERSONAL),
    switch("signature_block", True, PERSONAL),
    choice("double_click", "zoom", ("zoom", "toggle"), PERSONAL),
    switch("model_warnings", True, PERSONAL),
    choice("slide_submitted_notice", "bell", ("email", "bell", "quiet"), PERSONAL),
    choice("shortcut_preset", "default", ("default", "qupath", "figma"), PERSONAL),
    keys("shortcut_custom", PERSONAL),
    switch("shortcut_single_letter", True, PERSONAL),
    switch("shortcut_by_position", True, PERSONAL),
    choice("shortcut_whole_slide_key", "both", ("both", "hold", "tap"), PERSONAL),
)

BY_KEY: Mapping[str, Setting] = {setting.key: setting for setting in CATALOGUE}


def ts_type(setting: Setting) -> str:
    match setting.kind:
        case Kind.CHOICE:
            return " | ".join(json.dumps(option) for option in setting.options)
        case Kind.SWITCH:
            return "boolean"
        case Kind.WHOLE:
            return "number"
        case Kind.ID:
            return "string"
        case Kind.NAMES:
            return "string[]"
        case Kind.KEYS:
            return "Record<string, string[]>"


def entry(setting: Setting) -> dict[str, Any]:
    described: dict[str, Any] = {
        "kind": setting.kind.value,
        "default": list(setting.default) if isinstance(setting.default, tuple) else setting.default,
        "layers": sorted(layer.value for layer in setting.layers),
    }
    if setting.options:
        described["options"] = list(setting.options)
    if setting.maximum is not None and setting.minimum is None:
        described["maximum"] = setting.maximum
    if setting.minimum is not None:
        described["minimum"] = setting.minimum
        described["maximum"] = setting.maximum
    return described


def render() -> str:
    fields = "\n".join(f"  {setting.key}: {ts_type(setting)};" for setting in CATALOGUE)
    entries = json.dumps({setting.key: entry(setting) for setting in CATALOGUE}, indent=2)
    return (
        'export type Layer = "lab" | "personal" | "device";\n\n'
        f"export type SettingValues = {{\n{fields}\n}};\n\n"
        "export type SettingKey = keyof SettingValues;\n\n"
        "export type SettingEntry = {\n"
        '  kind: "choice" | "switch" | "whole" | "id" | "names" | "keys";\n'
        "  default: string | boolean | number | string[] | Record<string, string[]>;\n"
        "  layers: Layer[];\n"
        "  options?: string[];\n"
        "  minimum?: number;\n"
        "  maximum?: number;\n"
        "};\n\n"
        f"export const catalogue: Record<SettingKey, SettingEntry> = {entries};\n"
    )


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else TS_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render())


if __name__ == "__main__":
    main()
