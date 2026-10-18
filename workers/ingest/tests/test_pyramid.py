import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pytest
from fixture_support import fixture_path

from parfocal_ingest.identify import Format, Identified, Refusal, identify
from parfocal_ingest.pyramid import (
    Notice,
    Pyramid,
    Reader,
    Stored,
    ladder,
    read_pyramid,
    scale_of,
    scn_main_images,
    unpack,
)


@dataclass(frozen=True)
class Expected:
    reader: Reader
    levels: list[str]
    mpp: tuple[float, float] | None
    power: float | None
    notices: tuple[Notice, ...] = ()
    planes: int = 1


ESTIMATED = (Notice.OBJECTIVE_ESTIMATED,)

TABLES = {
    "CMU-1-Small-Region.svs": Expected(
        Reader.OPENSLIDE, ["1 2220x2967 240x240 jpeg rgb"], (0.499, 0.499), 20
    ),
    "CMU-1.svs": Expected(
        Reader.OPENSLIDE,
        [
            "1 46000x32914 256x256 jpeg rgb",
            "4 11500x8228 256x256 jpeg rgb",
            "16 2875x2057 256x256 jpeg rgb",
        ],
        (0.499, 0.499),
        20,
    ),
    "CMU-2.svs": Expected(
        Reader.OPENSLIDE,
        [
            "1 78000x30462 256x256 jpeg rgb",
            "4 19500x7615 256x256 jpeg rgb",
            "16 4875x1903 256x256 jpeg rgb",
            "32 2437x951 256x256 jpeg rgb",
        ],
        (0.499, 0.499),
        20,
    ),
    "JP2K-33003-1.svs": Expected(
        Reader.OPENSLIDE,
        [
            "1 15374x17497 256x256 jpeg2000 ycbcr",
            "4 3843x4374 256x256 jpeg2000 ycbcr",
            "8 1921x2187 256x256 jpeg2000 ycbcr",
        ],
        (0.2498, 0.2498),
        40,
    ),
    "JP2K-33003-2.svs": Expected(
        Reader.OPENSLIDE,
        [
            "1 32671x47076 256x256 jpeg2000 ycbcr",
            "4 8167x11769 256x256 jpeg2000 ycbcr",
            "16 2041x2942 256x256 jpeg2000 ycbcr",
        ],
        (0.2498, 0.2498),
        40,
    ),
    "CMU-1-JP2K-33005.svs": Expected(
        Reader.OPENSLIDE,
        [
            "1 46000x32893 240x240 jpeg2000 rgb",
            "4 11500x8223 240x240 jpeg2000 rgb",
            "16 2875x2055 240x240 jpeg2000 rgb",
        ],
        (0.499, 0.499),
        20,
    ),
    "CMU-1.tiff": Expected(
        Reader.OPENSLIDE,
        [
            "1 46000x32914 256x256 jpeg ycbcr",
            "2 23000x16457 256x256 jpeg ycbcr",
            "4 11500x8228 256x256 jpeg ycbcr",
            "8 5750x4114 256x256 jpeg ycbcr",
            "16 2875x2057 256x256 jpeg ycbcr",
            "32 1437x1028 256x256 jpeg ycbcr",
            "64 718x514 256x256 jpeg ycbcr",
            "128 359x257 256x256 jpeg ycbcr",
            "256 179x128 256x256 jpeg ycbcr",
        ],
        None,
        None,
        (Notice.OBJECTIVE_MISSING, Notice.MPP_MISSING),
    ),
    "CMU-1.ndpi": Expected(
        Reader.OPENSLIDE,
        [
            "1 51200x38144 2048x8 jpeg ycbcr",
            "4 12800x9536 512x8 jpeg ycbcr",
            "16 3200x2384 128x8 jpeg ycbcr",
            "64 800x596 untiled jpeg ycbcr",
        ],
        (0.4564, 0.4551),
        20,
    ),
    "OS-1.ndpi": Expected(
        Reader.OPENSLIDE,
        [
            "1 122880x110592 4096x8 jpeg ycbcr",
            "2 61440x55296 2048x8 jpeg ycbcr",
            "4 30720x27648 1024x8 jpeg ycbcr",
            "8 15360x13824 512x8 jpeg ycbcr",
            "16 7680x6912 256x8 jpeg ycbcr",
            "32 3840x3456 128x8 jpeg ycbcr",
            "64 1920x1728 64x8 jpeg ycbcr",
            "128 960x864 32x8 jpeg ycbcr",
            "256 480x432 16x8 jpeg ycbcr",
            "512 240x216 8x8 jpeg ycbcr",
        ],
        (0.2271, 0.2271),
        40,
    ),
    "Leica-1.scn": Expected(
        Reader.OPENSLIDE,
        [
            "1 36832x38432 512x512 jpeg ycbcr",
            "4 9208x9608 512x512 jpeg ycbcr",
            "16 2302x2402 512x512 jpeg ycbcr",
            "64 576x600 512x512 jpeg ycbcr",
            "256 144x150 512x512 jpeg ycbcr",
        ],
        (0.5, 0.5),
        20,
    ),
    "OS-1.bif": Expected(
        Reader.OPENSLIDE,
        [
            "1 105813x93951 in 118784x102000 1024x1360 jpeg ycbcr",
            "2 52907x46976 in 59392x51000 1024x1360 jpeg ycbcr",
            "4 26454x23488 in 29696x25504 1024x1360 jpeg ycbcr",
            "8 13227x11744 in 14848x12752 1024x1360 jpeg ycbcr",
            "16 6614x5872 in 7424x6376 1024x1360 jpeg ycbcr",
            "32 3307x2936 in 3712x3192 1024x1360 jpeg ycbcr",
            "64 1654x1468 in 1856x1600 1024x1360 jpeg ycbcr",
            "128 827x734 in 928x800 1024x1360 jpeg ycbcr",
            "256 414x367 in 464x400 1024x1360 jpeg ycbcr",
            "512 207x184 in 232x200 1024x1360 jpeg ycbcr",
        ],
        (0.2325, 0.2325),
        40,
    ),
    "Huron-1-40x.tif": Expected(
        Reader.OPENSLIDE,
        [
            "1 12040x21006 256x256 jpeg ycbcr",
            "4 3010x5252 256x256 jpeg ycbcr",
            "16 753x1313 256x256 jpeg ycbcr",
        ],
        (0.2, 0.2),
        40,
        ESTIMATED,
    ),
    "Huron-1-Uncompressed.tif": Expected(
        Reader.OPENSLIDE,
        [
            "1 6022x10503 256x256 none rgb",
            "4 1506x2626 256x256 none rgb",
            "16 377x657 256x256 none rgb",
        ],
        (0.4, 0.4),
        20,
        ESTIMATED,
    ),
    "Argos-1.avs": Expected(
        Reader.OPENSLIDE,
        [
            "1 130546x57440 512x512 jpeg ycbcr",
            "2 65273x28720 512x512 jpeg ycbcr",
            "4 32636x14360 512x512 jpeg ycbcr",
            "8 16318x7180 512x512 jpeg ycbcr",
            "16 8159x3590 512x512 jpeg ycbcr",
            "32 4079x1795 512x512 jpeg ycbcr",
            "64 2039x897 512x512 jpeg ycbcr",
            "128 1019x448 512x512 jpeg ycbcr",
        ],
        (0.383, 0.383),
        20,
    ),
    "Argos-1-Stacked.avs": Expected(
        Reader.OPENSLIDE,
        [
            "1 130546x57440 512x512 jpeg ycbcr",
            "2 65273x28720 512x512 jpeg ycbcr",
            "4 32636x14360 512x512 jpeg ycbcr",
            "8 16318x7180 512x512 jpeg ycbcr",
            "16 8159x3590 512x512 jpeg ycbcr",
            "32 4079x1795 512x512 jpeg ycbcr",
            "64 2039x897 512x512 jpeg ycbcr",
            "128 1019x448 512x512 jpeg ycbcr",
        ],
        (0.383, 0.383),
        20,
        (Notice.FIRST_PLANE_ONLY,),
        5,
    ),
    "Philips-4.tiff": Expected(
        Reader.OPENSLIDE,
        [
            "1 91136x68096 512x512 jpeg ycbcr",
            "2 45568x34048 512x512 jpeg ycbcr",
            "4 22784x17024 512x512 jpeg ycbcr",
            "8 11392x8512 512x512 jpeg ycbcr",
            "16 5696x4256 512x512 jpeg ycbcr",
            "32 2848x2128 512x512 jpeg ycbcr",
            "64 1424x1064 512x512 jpeg ycbcr",
            "128 712x532 512x512 jpeg ycbcr",
            "256 356x266 512x512 jpeg ycbcr",
        ],
        (0.25, 0.25),
        40,
        ESTIMATED,
    ),
    "Philips-3.tiff": Expected(
        Reader.OPENSLIDE,
        [
            "1 131072x100352 512x512 jpeg ycbcr",
            "2 65536x50176 512x512 jpeg ycbcr",
            "4 32768x25088 512x512 jpeg ycbcr",
            "8 16384x12544 512x512 jpeg ycbcr",
            "16 8192x6272 512x512 jpeg ycbcr",
            "32 4096x3136 512x512 jpeg ycbcr",
            "64 2048x1568 512x512 jpeg ycbcr",
            "128 1024x784 512x512 jpeg ycbcr",
            "256 512x392 512x512 jpeg ycbcr",
        ],
        (0.2269, 0.2269),
        40,
        ESTIMATED,
    ),
    "tumor_009.tif": Expected(
        Reader.OPENSLIDE,
        [
            "1 97792x217088 512x512 jpeg ycbcr",
            "2 48896x108544 512x512 jpeg ycbcr",
            "4 24448x54272 512x512 jpeg ycbcr",
            "8 12224x27136 512x512 jpeg ycbcr",
            "16 6112x13568 512x512 jpeg ycbcr",
            "32 3056x6784 512x512 jpeg ycbcr",
            "64 1528x3392 512x512 jpeg ycbcr",
            "128 764x1696 512x512 jpeg ycbcr",
            "256 382x848 512x512 jpeg ycbcr",
            "512 191x424 512x512 jpeg ycbcr",
        ],
        (0.2431, 0.2431),
        40,
        ESTIMATED,
    ),
    "CMU-1-Saved-1_16.zip": Expected(
        Reader.OPENSLIDE,
        [
            "1 7436x15494 untiled jpeg -",
            "2 3718x7747 untiled jpeg -",
            "4 1859x3873 untiled jpeg -",
            "8 929x1936 untiled jpeg -",
            "16 464x968 untiled jpeg -",
            "32 232x484 untiled jpeg -",
        ],
        (3.7172, 3.7163),
        20,
    ),
    "CMU-1-JP2K-33005-v2.zip": Expected(
        Reader.WSIDICOM,
        [
            "1 46000x32893 240x240 jpeg2000 rgb",
            "4 11500x8223 240x240 jpeg2000 rgb",
            "16 2875x2055 240x240 jpeg2000 rgb",
        ],
        (0.499, 0.499),
        20,
    ),
    "Leica-4.zip": Expected(
        Reader.WSIDICOM,
        [
            "1 23374x22079 256x256 jpeg ycbcr",
            "4 5843x5519 256x256 jpeg ycbcr",
            "16 1460x1379 256x256 jpeg ycbcr",
        ],
        (1.0511, 1.0511),
        40,
    ),
    "synthetic-jpeg.tiff": Expected(
        Reader.OPENSLIDE,
        [
            "1 1024x768 256x256 jpeg ycbcr",
            "2 512x384 256x256 jpeg ycbcr",
            "4 256x192 256x256 jpeg ycbcr",
        ],
        (0.5, 0.5),
        20,
        ESTIMATED,
    ),
    "synthetic-zlib.ome.tiff": Expected(
        Reader.TIFFSLIDE,
        [
            "1 1024x768 256x256 deflate rgb",
            "2 512x384 256x256 deflate rgb",
            "4 256x192 256x256 deflate rgb",
        ],
        (0.5, 0.5),
        20,
        ESTIMATED,
    ),
}


def read(name: str, workdir: Path) -> Pyramid | Refusal:
    path = fixture_path(name)
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    if found.variant == "zip" and found.format is not None:
        unpacked = unpack(path, workdir, found.format)
        if isinstance(unpacked, Refusal):
            return unpacked
        path = unpacked
    return read_pyramid(path, found)


def row(level_downsample: int, width: int, height: int, stored: Stored) -> str:
    extent = f"{width}x{height}"
    if (stored.width, stored.height) != (width, height):
        extent += f" in {stored.width}x{stored.height}"
    tile = f"{stored.tile_width}x{stored.tile_height}" if stored.tile_width else "untiled"
    return f"{level_downsample} {extent} {tile} {stored.compression} {stored.photometric or '-'}"


def table(found: Pyramid) -> list[str]:
    return [row(lv.downsample, lv.width, lv.height, lv.stored) for lv in found.levels]


@pytest.mark.parametrize("name", list(TABLES))
def test_every_supported_fixture_has_its_level_table(name: str, tmp_path: Path) -> None:
    expected = TABLES[name]
    found = read(name, tmp_path)
    assert isinstance(found, Pyramid), found
    assert table(found) == expected.levels
    scale = found.scale
    mpp = None if scale.mpp_x is None or scale.mpp_y is None else (scale.mpp_x, scale.mpp_y)
    assert mpp == (pytest.approx(expected.mpp, abs=1e-4) if expected.mpp else None)
    assert (found.reader, scale.objective_power, found.notices, found.planes) == (
        expected.reader,
        expected.power,
        expected.notices,
        expected.planes,
    )


def test_the_leica_decoy_is_not_taken_for_the_slide(tmp_path: Path) -> None:
    found = read("Leica-1.scn", tmp_path)
    assert isinstance(found, Pyramid)
    assert (found.levels[0].width, found.levels[0].height) == (36832, 38432)
    assert all((lv.width, lv.height) != (1616, 4668) for lv in found.levels)


@pytest.mark.parametrize(
    ("name", "refusal"),
    [
        ("Leica-3.scn", Refusal.MULTI_REGION),
        ("Ventana-1.bif", Refusal.UNREADABLE),
        ("Zeiss-5-Flat.czi", Refusal.ZEISS_CZI),
    ],
)
def test_slides_without_a_reader_are_refused_with_a_reason(
    name: str, refusal: Refusal, tmp_path: Path
) -> None:
    assert read(name, tmp_path) == refusal
    assert Identified(None, None, refusal).reason


def stored(width: int, height: int, tile: int | None = 512) -> Stored:
    return Stored(width, height, tile, tile, "jpeg", "ycbcr")


def test_tile_padded_levels_recover_their_true_factor() -> None:
    padded = [
        (97792, 217088),
        (49152, 108544),
        (24576, 54272),
        (12288, 27136),
        (6144, 13824),
        (3072, 7168),
        (1536, 3584),
        (1024, 2048),
        (512, 1024),
        (512, 512),
    ]
    levels, skipped = ladder([stored(width, height) for width, height in padded])
    assert not skipped
    assert [lv.downsample for lv in levels] == [2**k for k in range(10)]
    assert [(lv.width, lv.height) for lv in levels] == [
        (97792, 217088),
        (48896, 108544),
        (24448, 54272),
        (12224, 27136),
        (6112, 13568),
        (3056, 6784),
        (1528, 3392),
        (764, 1696),
        (382, 848),
        (191, 424),
    ]


def test_a_level_that_does_not_halve_is_skipped() -> None:
    levels, skipped = ladder([stored(1000, 1000, None), stored(700, 700, None)])
    assert skipped
    assert [lv.downsample for lv in levels] == [1]


@pytest.mark.parametrize(
    ("mpp", "power", "expected"),
    [
        ((0.25, 0.25), 40.0, (0.25, 0.25, 40.0, ())),
        ((None, None), 20.0, (0.5, 0.5, 20.0, (Notice.MPP_ESTIMATED,))),
        ((1000.0, 1000.0), 40.0, (0.25, 0.25, 40.0, (Notice.MPP_ESTIMATED,))),
        ((0.2269, 0.2269), None, (0.2269, 0.2269, 40.0, (Notice.OBJECTIVE_ESTIMATED,))),
        ((0.5, None), None, (0.5, 0.5, 20.0, (Notice.OBJECTIVE_ESTIMATED,))),
        (
            (None, None),
            None,
            (None, None, None, (Notice.OBJECTIVE_MISSING, Notice.MPP_MISSING)),
        ),
    ],
)
def test_missing_scale_falls_back_with_a_notice(
    mpp: tuple[float | None, float | None],
    power: float | None,
    expected: tuple[float | None, float | None, float | None, tuple[Notice, ...]],
) -> None:
    scale = scale_of(mpp[0], mpp[1], power)
    assert (scale.mpp_x, scale.mpp_y, scale.objective_power, scale.notices) == expected


SCN = (
    '<scn xmlns="http://www.leica-microsystems.com/scn/2010/10/01"><collection sizeX="9" sizeY="9">'
)


def scn_image(width: int, height: int) -> str:
    return f'<image><view sizeX="{width}" sizeY="{height}"/></image>'


def test_scn_main_images_do_not_count_the_macro() -> None:
    one = SCN + scn_image(9, 9) + scn_image(4, 4) + "</collection></scn>"
    two = SCN + scn_image(9, 9) + scn_image(4, 4) + scn_image(3, 3) + "</collection></scn>"
    assert (scn_main_images(one), scn_main_images(two), scn_main_images("not xml")) == (1, 2, 0)


def test_an_archive_that_escapes_its_folder_is_refused(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../slide.mrxs", b"x")
    path = tmp_path / "evil.zip"
    path.write_bytes(buffer.getvalue())
    assert unpack(path, tmp_path / "out", Format.MIRAX) == Refusal.ARCHIVE_WITHOUT_SLIDE
    assert not (tmp_path / "slide.mrxs").exists()


def test_a_refused_identification_stays_refused(tmp_path: Path) -> None:
    refused = Identified(None, None, Refusal.PLAIN_IMAGE)
    assert read_pyramid(tmp_path / "photo.jpg", refused) == Refusal.PLAIN_IMAGE
