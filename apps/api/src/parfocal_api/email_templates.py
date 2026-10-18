from collections.abc import Mapping
from dataclasses import dataclass
from html import escape
from string import Formatter

from parfocal_api.notification_catalogue import CATALOGUE
from parfocal_api.tables import NotificationKind

PARAMETERS = frozenset({"recipient_name", "workspace_name", "link"})
DIGEST_TEMPLATE = "notification.digest"


@dataclass(frozen=True)
class Template:
    name: str
    subject: str
    lines: tuple[str, ...]
    action: str


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


class TemplateParameterError(ValueError):
    pass


def notification_template(kind: NotificationKind) -> Template:
    entry = CATALOGUE[kind]
    return Template(
        name=f"notification.{kind}",
        subject=f"{entry.subject} in {{workspace_name}}",
        lines=("Hello {recipient_name},", entry.line, "Sign in to Parfocal to see it."),
        action="Open in Parfocal",
    )


TEMPLATES: Mapping[str, Template] = {
    "invitation": Template(
        name="invitation",
        subject="You have been invited to {workspace_name} on Parfocal",
        lines=(
            "Hello,",
            "You have been invited to join {workspace_name} on Parfocal.",
            "The invitation works once and expires in seven days.",
        ),
        action="Accept the invitation",
    ),
    **{f"notification.{kind}": notification_template(kind) for kind in NotificationKind},
    DIGEST_TEMPLATE: Template(
        name=DIGEST_TEMPLATE,
        subject="New activity in {workspace_name}",
        lines=(
            "Hello {recipient_name},",
            "Several things happened that need your attention.",
            "Sign in to Parfocal to see them.",
        ),
        action="Open your notifications",
    ),
}


def fields_of(template: Template) -> set[str]:
    return {
        name
        for text in (template.subject, *template.lines)
        for _, name, _, _ in Formatter().parse(text)
        if name
    } | {"link"}


def render(name: str, values: Mapping[str, str]) -> RenderedEmail:
    template = TEMPLATES[name]
    needed = fields_of(template)
    unknown = set(values) - PARAMETERS
    if unknown or not needed <= set(values):
        raise TemplateParameterError(f"{name} takes {sorted(needed)}, got {sorted(values)}")
    plain = {key: values[key] for key in needed}
    safe = {key: escape(value) for key, value in plain.items()}
    lines = [line.format(**plain) for line in template.lines]
    html_lines = "".join(f"<p>{line.format(**safe)}</p>" for line in template.lines)
    return RenderedEmail(
        subject=template.subject.format(**plain),
        text="\n\n".join([*lines, f"{template.action}: {plain['link']}"]),
        html=f'{html_lines}<p><a href="{safe["link"]}">{escape(template.action)}</a></p>',
    )
