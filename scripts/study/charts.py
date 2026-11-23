from html import escape

from study import round4
from study.analysis import Analysis, fixed, mean

INK = "#1f2933"
MUTED = "#6b7785"
GRID = "#d9dee4"
ROUND5 = "#2a6fdb"
ROUND4 = "#b2560f"
FONT = 'font-family="Helvetica, Arial, sans-serif"'


def svg(width: int, height: int, title: str, body: list[str]) -> str:
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
            f"<title>{escape(title)}</title>",
            f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
            *body,
            "</svg>",
            "",
        ]
    )


def label(
    x: float, y: float, text: str, size: int = 12, anchor: str = "start", fill: str = INK
) -> str:
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" {FONT} font-size="{size}" fill="{fill}" '
        f'text-anchor="{anchor}">{escape(text)}</text>'
    )


def seq_chart(analysis: Analysis) -> str:
    left, right, top, row_height = 230, 60, 56, 26
    width = 720
    plot = width - left - right
    height = top + row_height * len(analysis.tasks) + 44

    def x_of(value: float) -> float:
        return left + plot * (value - 1) / 6

    body = [label(16, 24, "SEQ per task, round 5 mean against the round 4 deck", 14)]
    body.append(
        label(
            16,
            42,
            "Bar: round 5 mean. Mark: round 4 per-task SEQ from the deck, slide 07.",
            11,
            fill=MUTED,
        )
    )
    for tick in range(1, 8):
        x = x_of(tick)
        body.append(
            f'<line x1="{x:.1f}" y1="{top - 6}" x2="{x:.1f}" y2="{height - 34}" stroke="{GRID}"/>'
        )
        body.append(label(x, height - 18, str(tick), 11, "middle", MUTED))
    for index, row in enumerate(analysis.tasks):
        y = top + index * row_height
        body.append(label(left - 8, y + 15, row.title, 12, "end"))
        value = mean(row.seqs)
        if value is not None:
            body.append(
                f'<rect x="{left}" y="{y + 4}" width="{x_of(value) - left:.1f}" '
                f'height="14" fill="{ROUND5}"/>'
            )
            body.append(label(x_of(value) + 6, y + 15, fixed(value), 11))
        figure = round4.BY_ID.get(row.task)
        if figure is not None:
            mark = x_of(float(figure.seq))
            body.append(
                f'<rect x="{mark - 1.5:.1f}" y="{y}" width="3" height="22" fill="{ROUND4}"/>'
            )
    return svg(width, height, "SEQ per task", body)


def sus_chart(analysis: Analysis) -> str:
    rounds = [
        ("Round 1", [round4.ROUND1_SUS], ROUND4, "deck slide 06"),
        ("Round 4", [score for _, score in round4.SUS_PER_PARTICIPANT], ROUND4, "deck slide 04"),
        (
            "Round 5",
            [row.score for row in analysis.sus if row.score is not None],
            ROUND5,
            "this export",
        ),
    ]
    left, right, top, row_height, width = 150, 40, 56, 46, 720
    plot = width - left - right
    height = top + row_height * len(rounds) + 40

    def x_of(value: float) -> float:
        return left + plot * value / 100

    body = [label(16, 24, "SUS per participant across rounds", 14)]
    body.append(
        label(
            16,
            42,
            "Dots: participants. Line: the round's mean. Rounds 1 and 4 from the round 4 deck.",
            11,
            fill=MUTED,
        )
    )
    for tick in range(0, 101, 20):
        x = x_of(tick)
        body.append(
            f'<line x1="{x:.1f}" y1="{top - 6}" x2="{x:.1f}" y2="{height - 30}" stroke="{GRID}"/>'
        )
        body.append(label(x, height - 14, str(tick), 11, "middle", MUTED))
    for index, (name, scores, colour, source) in enumerate(rounds):
        y = top + index * row_height + 16
        body.append(label(left - 10, y + 4, f"{name} (n={len(scores)})", 12, "end"))
        body.append(label(left - 10, y + 18, source, 10, "end", MUTED))
        seen: dict[float, int] = {}
        for score in scores:
            tie = seen.get(score, 0)
            seen[score] = tie + 1
            body.append(
                f'<circle cx="{x_of(score):.1f}" cy="{y + 10 * tie}" r="6" '
                f'fill="{colour}" fill-opacity="0.75"/>'
            )
        average = mean(scores)
        if average is not None:
            x = x_of(average)
            body.append(
                f'<line x1="{x:.1f}" y1="{y - 12}" x2="{x:.1f}" y2="{y + 12}" '
                f'stroke="{INK}" stroke-width="2"/>'
            )
            body.append(label(x, y - 16, fixed(average), 11, "middle"))
    return svg(width, height, "SUS per participant across rounds", body)
