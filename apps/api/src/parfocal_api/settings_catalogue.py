import json
import sys
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

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


LAB = frozenset({Layer.LAB})
PERSONAL = frozenset({Layer.PERSONAL})
DEVICE = frozenset({Layer.DEVICE})
LAB_OR_PERSONAL = frozenset({Layer.LAB, Layer.PERSONAL})


@dataclass(frozen=True)
class Setting:
    key: str
    kind: Kind
    default: str | bool | int
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
        return None


def choice(key: str, default: str, options: tuple[str, ...], layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.CHOICE, default, layers, options=options)


def switch(key: str, default: bool, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.SWITCH, default, layers)


def whole(key: str, default: int, low: int, high: int, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.WHOLE, default, layers, minimum=low, maximum=high)


def identifier(key: str, layers: frozenset[Layer]) -> Setting:
    return Setting(key, Kind.ID, "", layers)


CATALOGUE: tuple[Setting, ...] = (
    choice("theme", "system", ("system", "light", "dark"), DEVICE),
    whole("slide_brightness", 100, 20, 140, DEVICE),
    choice("density", "comfortable", ("comfortable", "compact"), PERSONAL),
    choice("patient_names", "full", ("full", "initials"), LAB_OR_PERSONAL),
    choice("length_unit", "um", ("um", "mm"), PERSONAL),
    choice("magnification_label", "objective", ("objective", "microns-per-pixel"), PERSONAL),
    choice("tools", "rail", ("rail", "dock"), PERSONAL),
    whole("side_panel_width", 320, 240, 560, PERSONAL),
    choice("minimap", "corner", ("corner", "hidden"), PERSONAL),
    switch("slide_strip", False, PERSONAL),
    choice("confidence_wording", "words", ("words", "numbers", "colour", "hidden"), PERSONAL),
    choice("outline_mode", "outline", ("outline", "fill", "dots"), PERSONAL),
    whole("decision_cutoff", 50, 0, 100, LAB),
    choice("wheel_mode", "zoom", ("zoom", "pan"), DEVICE),
    switch("invert_zoom", False, DEVICE),
    choice("camera_feel", "smooth", ("smooth", "precise", "instant"), DEVICE),
    switch("notify_ai_finished", True, PERSONAL),
    switch("notify_replies", True, PERSONAL),
    switch("initials_while_sharing", True, PERSONAL),
    whole("lock_after_minutes", 15, 1, 240, LAB),
    switch("patient_banner", True, LAB),
    choice("default_privacy_mode", "de-identified", ("de-identified", "clinical"), LAB),
    choice("default_classes", "none", ("none", "sentinel-node", "pannuke"), LAB),
    identifier("default_study_template", LAB),
    whole("tumor_share_cutoff", 20, 1, 99, LAB),
    switch("tumor_share_result_sentinel_node", False, LAB),
    switch("tumor_share_result_pannuke", True, LAB),
    choice("home_layout", "role", ("role", "review", "research", "both"), PERSONAL),
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


def entry(setting: Setting) -> dict[str, Any]:
    described: dict[str, Any] = {
        "kind": setting.kind.value,
        "default": setting.default,
        "layers": sorted(layer.value for layer in setting.layers),
    }
    if setting.options:
        described["options"] = list(setting.options)
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
        '  kind: "choice" | "switch" | "whole" | "id";\n'
        "  default: string | boolean | number;\n"
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
