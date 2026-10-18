import pytest

from parfocal_api.email_templates import TEMPLATES, TemplateParameterError, fields_of, render
from parfocal_api.tables import NotificationKind

SENTINELS = {
    "recipient_name": "RECIPIENT-SENTINEL",
    "workspace_name": "WORKSPACE-SENTINEL",
    "link": "https://parfocal.test/go/00000000-0000-0000-0000-000000000001",
}
PATIENT_SENTINELS = ("Eva Testová", "MRN123456", "1970-01-02", "S26-0042", "tumor_009")


def test_the_template_set_and_its_parameters_are_the_reviewed_ones() -> None:
    assert {name: sorted(fields_of(template)) for name, template in TEMPLATES.items()} == {
        "invitation": ["link", "workspace_name"],
        **{
            f"notification.{kind}": ["link", "recipient_name", "workspace_name"]
            for kind in NotificationKind
        },
    }


@pytest.mark.parametrize("name", sorted(TEMPLATES))
def test_every_template_renders_only_its_parameters_and_links_to_the_app(name: str) -> None:
    needed = fields_of(TEMPLATES[name])
    email = render(name, {key: SENTINELS[key] for key in needed})
    output = email.subject + email.text + email.html
    for key in needed:
        assert SENTINELS[key] in output, key
    assert SENTINELS["link"] in email.text
    assert f'href="{SENTINELS["link"]}"' in email.html
    assert "{" not in output
    assert not any(value in output for value in PATIENT_SENTINELS)
    assert SENTINELS["link"] not in email.subject


def test_a_template_refuses_any_other_value() -> None:
    with pytest.raises(TemplateParameterError):
        render("notification.mention", {**SENTINELS, "patient_name": PATIENT_SENTINELS[0]})
    with pytest.raises(TemplateParameterError):
        render("invitation", {"link": SENTINELS["link"]})


def test_names_are_escaped_in_html() -> None:
    email = render(
        "invitation", {"workspace_name": "<script>x</script>", "link": SENTINELS["link"]}
    )
    assert "<script>" not in email.html
    assert "&lt;script&gt;" in email.html
