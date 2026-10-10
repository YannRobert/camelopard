"""Images of the demo Jira, drawn as SVG: type and priority icons, and the scenarios' attachments.

Drawn here rather than copied from Jira: Atlassian's icons are theirs, and the repository ships no binary.
"""

TYPE_ICONS = {
    # Green bookmark, red dot, blue tick: the shapes and colours people know from Jira, redrawn.
    "story.svg": (
        '<rect width="16" height="16" rx="2" fill="#63ba3c"/>'
        '<path d="M5 3.5h6v9l-3-2.2-3 2.2z" fill="#fff"/>'
    ),
    "bug.svg": (
        '<rect width="16" height="16" rx="2" fill="#e5493a"/>'
        '<circle cx="8" cy="8" r="3.5" fill="#fff"/>'
    ),
    "task.svg": (
        '<rect width="16" height="16" rx="2" fill="#4bade8"/>'
        '<path d="M4.5 8.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"/>'
    ),
}

PRIORITY_ICONS = {
    "highest.svg": (
        '<path d="M3.5 8.5L8 4l4.5 4.5M3.5 12.5L8 8l4.5 4.5" fill="none" stroke="#cd1317" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    "high.svg": (
        '<path d="M3.5 10.5L8 6l4.5 4.5" fill="none" stroke="#e9494a" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"/>'
    ),
    "medium.svg": (
        '<path d="M3.5 6h9M3.5 10h9" stroke="#e97f33" stroke-width="2" stroke-linecap="round"/>'
    ),
    "low.svg": (
        '<path d="M3.5 5.5L8 10l4.5-4.5" fill="none" stroke="#2d8738" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"/>'
    ),
}


def icon(name):
    """SVG bytes of a type or priority icon; None if unknown."""
    shapes = TYPE_ICONS.get(name) or PRIORITY_ICONS.get(name)
    return shapes and svg(
        16,
        16,
        shapes
    )


def attachment(
        drawings,
        name
):
    """SVG bytes of an attachment, from a scenario's drawings: {file name: (width, height, shapes)}."""
    drawing = drawings.get(name)
    return drawing and svg(*drawing)


def svg(
        width,
        height,
        shapes
):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="sans-serif">{shapes}</svg>'
    ).encode()
