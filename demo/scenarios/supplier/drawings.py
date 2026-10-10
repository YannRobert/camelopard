"""The attachments of the passenger platform's specifications, drawn as SVG shapes: a sequence diagram and a
screen mockup."""

DRAWINGS = {
    "sequence-diagram.svg": (
        560,
        260,
        '<rect width="560" height="260" fill="#fff"/>'
        '<g font-size="13" fill="#172b4d" text-anchor="middle">'
        '<rect x="20" y="16" width="110" height="32" rx="4" fill="#deebff"/><text x="75" y="37">Web / App</text>'
        '<rect x="160" y="16" width="110" height="32" rx="4" fill="#e3fcef"/><text x="215" y="37">Booking engine</text>'
        '<rect x="300" y="16" width="110" height="32" rx="4" fill="#fffae6"/><text x="355" y="37">Reservation</text>'
        '<rect x="440" y="16" width="110" height="32" rx="4" fill="#ffebe6"/><text x="495" y="37">Payments</text>'
        '</g>'
        '<g stroke="#c1c7d0" stroke-dasharray="4 4"><path d="M75 48v200M215 48v200M355 48v200M495 48v200"/></g>'
        '<g stroke="#5e6c84" stroke-width="1.5" marker-end="url(#a)">'
        '<path d="M75 80h134"/><path d="M215 112h134"/><path d="M355 144h-134"/>'
        '<path d="M215 176h274"/><path d="M215 220h-134"/></g>'
        '<g font-size="11" fill="#42526e">'
        '<text x="82" y="74">rebook(PNR)</text><text x="222" y="106">availability</text>'
        '<text x="228" y="138">alternatives</text><text x="300" y="170">fare difference</text>'
        '<text x="92" y="214">offer</text></g>'
        '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
        '<path d="M0 0L8 4 0 8z" fill="#5e6c84"/></marker></defs>'
    ),
    "screen-mockup.svg": (
        360,
        300,
        '<rect width="360" height="300" rx="12" fill="#f4f5f7"/>'
        '<text x="20" y="36" font-size="17" font-weight="bold" fill="#172b4d">Your flight is cancelled</text>'
        '<text x="20" y="58" font-size="12" fill="#5e6c84">Choose another flight at no extra cost</text>'
        '<rect x="20" y="76" width="320" height="56" rx="6" fill="#fff" stroke="#0052cc" stroke-width="2"/>'
        '<text x="36" y="100" font-size="14" fill="#172b4d">07:40 to 10:15 · direct</text>'
        '<text x="36" y="120" font-size="12" fill="#00875a">Same fare</text>'
        '<rect x="20" y="142" width="320" height="56" rx="6" fill="#fff" stroke="#dfe1e6"/>'
        '<text x="36" y="166" font-size="14" fill="#172b4d">11:05 to 15:50 · 1 stop</text>'
        '<text x="36" y="186" font-size="12" fill="#00875a">Same fare</text>'
        '<rect x="20" y="236" width="320" height="44" rx="6" fill="#0052cc"/>'
        '<text x="180" y="264" font-size="15" font-weight="bold" fill="#fff" text-anchor="middle">Confirm</text>'
    ),
}
