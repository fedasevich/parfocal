import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import tifffile

from parfocal_ingest.restricted_ranges import ByteRange, merged, ranges_document, restricted_ranges

IMAGE_DESCRIPTION = 270
DOCUMENT_NAME = 269
PAGE_NAME = 285
ARTIST = 315
XMP = 700
NDPI_REFERENCE = 65427
WHOLE_IDENTIFYING_TAGS = frozenset({DOCUMENT_NAME, PAGE_NAME, ARTIST})
WHOLE_BARCODE_TAGS = frozenset({NDPI_REFERENCE})
TEXT_TAGS = frozenset({IMAGE_DESCRIPTION, XMP}) | WHOLE_IDENTIFYING_TAGS | WHOLE_BARCODE_TAGS

SVS_TECHNICAL_KEYS = frozenset(
    {
        "AppMag",
        "MPP",
        "StripeWidth",
        "ScanScope ID",
        "Left",
        "Top",
        "LineCameraSkew",
        "LineAreaXOffset",
        "LineAreaYOffset",
        "Focus Offset",
        "ImageID",
        "OriginalWidth",
        "OriginalHeight",
        "Filtered",
        "ICC Profile",
        "Exposure Time",
        "Exposure Scale",
        "DisplayColor",
        "SessionMode",
        "Parmset",
        "Rack",
        "Slot",
        "Time Zone",
    }
)
SVS_FIELD = re.compile(rb"\|([^|=\r\n]+?) = ([^|]*)")
SCN_BARCODE = re.compile(rb"<barcode>([^<]*)</barcode>")
SCN_IDENTIFYING = re.compile(
    rb"""\sname="([^"]*)"|<creationDate>([^<]*)</creationDate>|<description>([^<]*)</description>"""
)
PHILIPS_ATTRIBUTE = re.compile(rb'<Attribute Name="([A-Z0-9_]+)"[^>]*>([^<]*)</Attribute>')
PHILIPS_BARCODE = b"PIM_DP_UFS_BARCODE"
PHILIPS_IDENTIFYING_PARTS = (
    b"PATIENT",
    b"ACCESSION",
    b"STUDY",
    b"PHYSICIAN",
    b"OPERATOR",
    b"INSTITUTION",
    b"DESCRIPTION",
    b"_DATE",
    b"_TIME",
    b"BARCODE",
)
OME_IDENTIFYING = re.compile(
    rb'<Image\b[^>]*?\sName="([^"]*)"'
    rb"|<Description>([^<]*)</Description>"
    rb'|\s(?:FirstName|MiddleName|LastName|Email|UserName|Institution)="([^"]*)"'
)
XMP_BARCODE = re.compile(rb'\s[Bb]ar[Cc]ode\w*="([^"]*)"')


@dataclass
class IdentifyingText:
    identifying: list[ByteRange] = field(default_factory=list[ByteRange])
    barcode: list[ByteRange] = field(default_factory=list[ByteRange])


def group_spans(pattern: re.Pattern[bytes], value: bytes, base: int) -> Iterator[ByteRange]:
    for match in pattern.finditer(value):
        for index in range(1, (pattern.groups or 0) + 1):
            start, end = match.span(index)
            if start >= 0 and end > start:
                yield base + start, base + end


def whole_value(value: bytes, base: int) -> Iterator[ByteRange]:
    text = value.rstrip(b"\0")
    if text.strip():
        yield base, base + len(text)


def svs_fields(value: bytes, base: int, found: IdentifyingText) -> None:
    for match in SVS_FIELD.finditer(value):
        key = match.group(1).decode("latin-1").strip()
        start, end = match.span(2)
        if key in SVS_TECHNICAL_KEYS or end <= start:
            continue
        target = found.barcode if "barcode" in key.lower() else found.identifying
        target.append((base + start, base + end))


def philips_attributes(value: bytes, base: int, found: IdentifyingText) -> None:
    for match in PHILIPS_ATTRIBUTE.finditer(value):
        name = match.group(1)
        start, end = match.span(2)
        if end <= start:
            continue
        if name == PHILIPS_BARCODE:
            found.barcode.append((base + start, base + end))
        elif any(part in name for part in PHILIPS_IDENTIFYING_PARTS):
            found.identifying.append((base + start, base + end))


def description_text(value: bytes, base: int, found: IdentifyingText) -> None:
    if value.startswith(b"Aperio"):
        svs_fields(value, base, found)
    elif b"<scn" in value:
        found.barcode.extend(group_spans(SCN_BARCODE, value, base))
        found.identifying.extend(group_spans(SCN_IDENTIFYING, value, base))
    elif b"<DataObject" in value:
        philips_attributes(value, base, found)
    elif b"<OME" in value:
        found.identifying.extend(group_spans(OME_IDENTIFYING, value, base))


def tag_text(code: int, value: bytes, base: int, found: IdentifyingText) -> None:
    if code == IMAGE_DESCRIPTION:
        description_text(value, base, found)
    elif code == XMP:
        found.barcode.extend(group_spans(XMP_BARCODE, value, base))
    elif code in WHOLE_BARCODE_TAGS:
        found.barcode.extend(whole_value(value, base))
    elif code in WHOLE_IDENTIFYING_TAGS:
        found.identifying.extend(whole_value(value, base))


def text_tags(tiff: tifffile.TiffFile) -> Iterator[tuple[int, int, int]]:
    tiff.pages.useframes = False
    for page in tiff.pages:
        if not isinstance(page, tifffile.TiffPage):
            continue
        for tag in page.tags.values():
            if tag.code in TEXT_TAGS:
                yield tag.code, tag.valueoffset, tag.count


def identifying_text(path: Path) -> IdentifyingText:
    found = IdentifyingText()
    try:
        with tifffile.TiffFile(path) as tiff:
            spans = list(text_tags(tiff))
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return found
    with path.open("rb") as handle:
        for code, offset, count in spans:
            handle.seek(offset)
            tag_text(code, handle.read(count), offset, found)
    return IdentifyingText(merged(found.identifying), merged(found.barcode))


def ranges_file(path: Path) -> bytes:
    text = identifying_text(path)
    return ranges_document(restricted_ranges(path), text.identifying, text.barcode)
