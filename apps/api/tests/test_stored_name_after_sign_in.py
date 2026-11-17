from parfocal_api.auth import SEEDED_OWNER_NAME, stored_name_after_sign_in


def test_a_seeded_name_is_replaced_by_the_profile_name() -> None:
    assert stored_name_after_sign_in(SEEDED_OWNER_NAME, "Ada Lovelace") == "Ada Lovelace"


def test_a_name_the_person_chose_is_kept() -> None:
    assert stored_name_after_sign_in("Ada L.", "Ada Lovelace") is None


def test_a_seeded_name_stays_when_the_profile_has_no_name() -> None:
    assert stored_name_after_sign_in(SEEDED_OWNER_NAME, None) is None
    assert stored_name_after_sign_in(SEEDED_OWNER_NAME, "   ") is None


def test_a_new_user_has_nothing_to_replace() -> None:
    assert stored_name_after_sign_in(None, "Ada Lovelace") is None
