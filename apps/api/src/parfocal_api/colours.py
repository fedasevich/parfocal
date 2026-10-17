import math
from enum import StrEnum

type Rgb = tuple[int, int, int]


class Vision(StrEnum):
    NORMAL = "normal"
    PROTANOPIA = "protanopia"
    DEUTERANOPIA = "deuteranopia"
    TRITANOPIA = "tritanopia"


MACHADO = {
    Vision.PROTANOPIA: (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    Vision.DEUTERANOPIA: (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.01182, 0.04294, 0.968881),
    ),
    Vision.TRITANOPIA: (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.3039),
    ),
}


def parse_hex(colour: str) -> Rgb:
    value = colour.removeprefix("#")
    if len(value) != 6:
        raise ValueError(f"Not a #rrggbb colour: {colour}")
    channels = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return channels


def linear(channel: float) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def gamma(channel: float) -> float:
    c = min(1.0, max(0.0, channel))
    return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)


def simulate(rgb: Rgb, vision: Vision) -> Rgb:
    if vision is Vision.NORMAL:
        return rgb
    lin = [linear(c) for c in rgb]
    rows = MACHADO[vision]
    r, g, b = (
        math.floor(gamma(sum(w * v for w, v in zip(row, lin, strict=True))) + 0.5) for row in rows
    )
    return r, g, b


def lab(rgb: Rgb) -> tuple[float, float, float]:
    r, g, b = (linear(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return math.cbrt(t) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def hue(b: float, a: float) -> float:
    if a == 0 and b == 0:
        return 0.0
    angle = math.degrees(math.atan2(b, a))
    return angle + 360 if angle < 0 else angle


def ciede2000(first: Rgb, second: Rgb) -> float:
    l1, a1, b1 = lab(first)
    l2, a2, b2 = lab(second)
    c_mean = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    g = 0.5 * (1 - math.sqrt(c_mean**7 / (c_mean**7 + 25**7)))
    ap1, ap2 = (1 + g) * a1, (1 + g) * a2
    cp1, cp2 = math.hypot(ap1, b1), math.hypot(ap2, b2)
    hp1, hp2 = hue(b1, ap1), hue(b2, ap2)
    dl, dc = l2 - l1, cp2 - cp1
    dh = 0.0
    if cp1 * cp2 != 0:
        dh = hp2 - hp1
        if dh > 180:
            dh -= 360
        elif dh < -180:
            dh += 360
    dh_big = 2 * math.sqrt(cp1 * cp2) * math.sin(math.radians(dh / 2))
    l_mean, cp_mean = (l1 + l2) / 2, (cp1 + cp2) / 2
    h_mean = hp1 + hp2
    if cp1 * cp2 != 0:
        if abs(hp1 - hp2) > 180:
            h_mean += 360 if h_mean < 360 else -360
        h_mean /= 2
    t = (
        1
        - 0.17 * math.cos(math.radians(h_mean - 30))
        + 0.24 * math.cos(math.radians(2 * h_mean))
        + 0.32 * math.cos(math.radians(3 * h_mean + 6))
        - 0.2 * math.cos(math.radians(4 * h_mean - 63))
    )
    d_theta = 30 * math.exp(-(((h_mean - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cp_mean**7 / (cp_mean**7 + 25**7))
    sl = 1 + 0.015 * (l_mean - 50) ** 2 / math.sqrt(20 + (l_mean - 50) ** 2)
    sc = 1 + 0.045 * cp_mean
    sh = 1 + 0.015 * cp_mean * t
    rt = -math.sin(math.radians(2 * d_theta)) * rc
    return math.sqrt(
        (dl / sl) ** 2 + (dc / sc) ** 2 + (dh_big / sh) ** 2 + rt * (dc / sc) * (dh_big / sh)
    )


def separation(first: str, second: str) -> tuple[float, Vision]:
    a, b = parse_hex(first), parse_hex(second)
    return min((ciede2000(simulate(a, v), simulate(b, v)), v) for v in Vision)
