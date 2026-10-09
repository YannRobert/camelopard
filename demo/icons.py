"""Images of the demo Jira, drawn as SVG: type and priority icons, and the attachments.

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

ATTACHMENTS = {
    "checkout-mockup.svg": (
        480,
        300,
        '<rect width="480" height="300" fill="#f4f5f7"/>'
        '<text x="24" y="40" font-size="20" font-weight="bold" fill="#172b4d">Payment</text>'
        '<rect x="24" y="64" width="432" height="56" rx="6" fill="#fff" stroke="#0052cc" stroke-width="2"/>'
        '<rect x="40" y="80" width="40" height="24" rx="3" fill="#1a1f71"/>'
        '<text x="96" y="97" font-size="15" fill="#172b4d">Visa ending in 4242 · last used</text>'
        '<rect x="24" y="132" width="432" height="56" rx="6" fill="#fff" stroke="#dfe1e6"/>'
        '<rect x="40" y="148" width="40" height="24" rx="3" fill="#eb001b"/>'
        '<text x="96" y="165" font-size="15" fill="#172b4d">Mastercard ending in 5100</text>'
        '<text x="24" y="218" font-size="14" fill="#0052cc">+ Use another card</text>'
        '<rect x="24" y="236" width="432" height="44" rx="6" fill="#0052cc"/>'
        '<text x="240" y="264" font-size="16" font-weight="bold" fill="#fff" text-anchor="middle">Pay €24.90</text>'
    ),
    "apple-pay-flow.svg": (
        480,
        160,
        '<rect width="480" height="160" fill="#fff"/>'
        '<g font-size="14" fill="#172b4d" text-anchor="middle">'
        '<rect x="16" y="50" width="120" height="60" rx="8" fill="#deebff"/><text x="76" y="85">Product page</text>'
        '<rect x="180" y="50" width="120" height="60" rx="8" fill="#e3fcef"/><text x="240" y="85">Apple Pay sheet</text>'
        '<rect x="344" y="50" width="120" height="60" rx="8" fill="#fffae6"/><text x="404" y="85">Order confirmed</text>'
        '</g>'
        '<path d="M140 80h34M304 80h34" stroke="#5e6c84" stroke-width="2" marker-end="url(#a)"/>'
        '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
        '<path d="M0 0L8 4 0 8z" fill="#5e6c84"/></marker></defs>'
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


def attachment(name):
    drawing = ATTACHMENTS.get(name)
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
