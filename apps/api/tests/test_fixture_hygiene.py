import re
from pathlib import Path

from synthetic_people import SYNTHETIC_PATIENT_NAMES

ROOT = Path(__file__).resolve().parents[3]
SOURCES = ("apps/api/tests", "workers/ingest/tests", "workers/ml/tests", "packages/py-common/tests")
IDENTITY = re.compile(r'PatientIdentity\(\s*"([^"]+)"')
PATIENT_BODY = re.compile(r'"patient":\s*\{[^}]*?"name":\s*"([^"]+)"', re.DOTALL)
CSV_ROWS = re.compile(r'\{HEADER\}(?:,\w+)*((?:\\n[^"\\]*)+)')
NAME_COLUMN = 4


def patient_names(text: str) -> set[str]:
    found = set(IDENTITY.findall(text)) | set(PATIENT_BODY.findall(text))
    for rows in CSV_ROWS.findall(text):
        for row in rows.split("\\n"):
            fields = row.split(",")
            if len(fields) > NAME_COLUMN and fields[NAME_COLUMN]:
                found.add(fields[NAME_COLUMN])
    return found


def scanned() -> dict[str, set[str]]:
    names: dict[str, set[str]] = {}
    for folder in SOURCES:
        for path in sorted((ROOT / folder).rglob("*")):
            if path == Path(__file__).resolve():
                continue
            if path.suffix in {".py", ".json", ".csv", ".geojson"} and path.is_file():
                found = patient_names(path.read_text(encoding="utf-8", errors="ignore"))
                if found:
                    names[str(path.relative_to(ROOT))] = found
    return names


def test_every_patient_name_in_tests_and_fixtures_is_a_registered_synthetic_name() -> None:
    unregistered = {
        path: sorted(found - SYNTHETIC_PATIENT_NAMES)
        for path, found in scanned().items()
        if found - SYNTHETIC_PATIENT_NAMES
    }
    assert unregistered == {}


def test_the_scanner_finds_names_in_each_place_a_test_puts_them() -> None:
    sample = (
        'PatientIdentity("Real Person", "MRN1")\n'
        '{"patient": {"mrn": "M1", "name": "Another Person"}}\n'
        'f"{HEADER}\\nC1,A1,,,Third Person,M1,,,\\n"\n'
    )
    assert patient_names(sample) == {"Real Person", "Another Person", "Third Person"}
    assert {"Real Person", "Another Person", "Third Person"} - SYNTHETIC_PATIENT_NAMES
