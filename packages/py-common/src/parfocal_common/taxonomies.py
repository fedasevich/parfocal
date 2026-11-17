from enum import StrEnum


class TaxonomyTemplate(StrEnum):
    SENTINEL_NODE = "sentinel-node"
    PANNUKE = "pannuke"


TEMPLATES: dict[TaxonomyTemplate, tuple[tuple[str, str], ...]] = {
    TaxonomyTemplate.SENTINEL_NODE: (
        ("Tumor", "#f87171"),
        ("Stroma", "#6ee7b7"),
        ("Immune", "#c084fc"),
        ("Other", "#fbbf24"),
    ),
    TaxonomyTemplate.PANNUKE: (
        ("Neoplastic", "#f87171"),
        ("Inflammatory", "#c084fc"),
        ("Connective", "#6ee7b7"),
        ("Dead", "#fbbf24"),
        ("Epithelial", "#43999d"),
    ),
}


def class_names(template: TaxonomyTemplate) -> tuple[str, ...]:
    return tuple(name for name, _ in TEMPLATES[template])
