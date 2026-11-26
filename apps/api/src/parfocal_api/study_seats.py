from parfocal_api.auth import SEEDED_SUBJECT_PREFIX

STUDY_SEAT_PREFIX = f"{SEEDED_SUBJECT_PREFIX}study-"
STUDY_SEAT_DOMAIN = "@showcase.invalid"


def is_study_seat(subject: str) -> bool:
    return subject.startswith(STUDY_SEAT_PREFIX) and subject.endswith(STUDY_SEAT_DOMAIN)
