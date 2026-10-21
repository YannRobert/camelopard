"""The fictional team, workflow and issues of the heavy demo board.

An airline's passenger platform (booking, loyalty, check-in) is built by an outside supplier: the business
side writes and accepts the specifications, the supplier develops and tests them, and every handover is a
status. The result is the kind of board some companies run: many columns, a large team, hundreds of issues,
long specifications and long comment threads, histories that go back and forth.

Everything here is invented, and the issues are generated from the vocabulary below with a fixed seed: the
same board at every start. Dates are not stored: the fake Jira's board places every event relative to the
moment the demo starts.
"""
import random

from ..common import BOT, FIELDS, PRIORITIES, PRIORITY_IDS, TYPES, TYPE_IDS  # noqa: F401  (read by the fake Jira)
from .drawings import DRAWINGS  # noqa: F401

PROJECT_KEY = "PAX"
PROJECT_NAME = "Passenger Platform"
BOARD_NAME = "Passenger platform delivery board"
FIRST_ISSUE_NUMBER = 1201
EMAIL_DOMAIN = "passenger-platform.example"
SEED = "supplier"

# The person looking at the board (GET rest/api/2/myself): a developer at the supplier.
ME = "arjun"

# Business analysts write the specifications and accept the deliveries.
ANALYSTS = {
    "ines": "Inès Moreau",
    "kwame": "Kwame Mensah",
    "lucia": "Lucía Fernández",
    "oskar": "Oskar Lindqvist",
}
SUPPLIER_DEVELOPERS = {
    "arjun": "Arjun Mehta",
    "beatriz": "Beatriz Santos",
    "chen": "Chen Wei",
    "daniel": "Daniel Novak",
    "elif": "Elif Yılmaz",
    "felix": "Felix Wagner",
    "hana": "Hana Kobayashi",
    "ivan": "Ivan Petrov",
    "jonas": "Jonas Berg",
    "kofi": "Kofi Asante",
    "leila": "Leila Rahimi",
    "marco": "Marco Rossi",
}
SUPPLIER_TESTERS = {
    "nina": "Nina Kowalska",
    "omar": "Omar Khalil",
    "priya": "Priya Nair",
    "quentin": "Quentin Lambert",
    "rosa": "Rosa Jiménez",
    "sven": "Sven Olsen",
    "tomas": "Tomás Ruiz",
    "yara": "Yara Costa",
}
PEOPLE = {**ANALYSTS, **SUPPLIER_DEVELOPERS, **SUPPLIER_TESTERS}
DEVELOPERS = tuple(SUPPLIER_DEVELOPERS)
TESTERS = tuple(SUPPLIER_TESTERS)
REPORTERS = tuple(ANALYSTS)

# Status id: (name, status category key).
STATUSES = {
    "1": ("Backlog", "new"),
    "10300": ("Refinement", "new"),
    "10301": ("Ready for supplier", "new"),
    "10302": ("Sent to supplier", "indeterminate"),
    "10303": ("Estimated by supplier", "indeterminate"),
    "3": ("In development", "indeterminate"),
    "10304": ("Code review", "indeterminate"),
    "10305": ("Merged", "indeterminate"),
    "10306": ("To deliver to staging", "indeterminate"),
    "10307": ("Delivered to staging", "indeterminate"),
    "10308": ("Supplier QA", "indeterminate"),
    "10309": ("Supplier QA failed", "indeterminate"),
    "10310": ("Supplier QA passed", "indeterminate"),
    "10311": ("Business acceptance", "indeterminate"),
    "10312": ("Acceptance failed", "indeterminate"),
    "10313": ("Accepted", "indeterminate"),
    "10314": ("Ready for release", "indeterminate"),
    "10001": ("Released", "done"),
}
# The failed statuses share the column of the check that sends issues there.
COLUMNS = (
    ("Backlog", ("1",)),
    ("Refinement", ("10300",)),
    ("Ready for supplier", ("10301",)),
    ("Sent to supplier", ("10302",)),
    ("Estimated by supplier", ("10303",)),
    ("In development", ("3",)),
    ("Code review", ("10304",)),
    ("Merged", ("10305",)),
    ("To deliver to staging", ("10306",)),
    ("Delivered to staging", ("10307",)),
    ("Supplier QA", ("10308", "10309")),
    ("Supplier QA passed", ("10310",)),
    ("Business acceptance", ("10311", "10312")),
    ("Accepted", ("10313",)),
    ("Ready for release", ("10314",)),
    ("Released", ("10001",)),
)
# From status: [(transition id, transition name, to status)], the way forward first: the simulated
# colleagues take the second one, backwards, now and then.
WORKFLOW = {
    "1": [("11", "Refine", "10300")],
    "10300": [("21", "Ready for supplier", "10301"), ("22", "Back to backlog", "1")],
    "10301": [("31", "Send to supplier", "10302"), ("32", "Back to refinement", "10300")],
    "10302": [("41", "Estimate", "10303"), ("42", "Return to business", "10300")],
    "10303": [("51", "Start development", "3"), ("52", "Return to business", "10300")],
    "3": [("61", "Request review", "10304"), ("62", "Stop development", "10303")],
    "10304": [("71", "Merge", "10305"), ("72", "Request changes", "3")],
    "10305": [("81", "Plan delivery", "10306")],
    "10306": [("91", "Deliver to staging", "10307")],
    "10307": [("101", "Start supplier QA", "10308")],
    "10308": [("111", "Pass supplier QA", "10310"), ("112", "Fail supplier QA", "10309")],
    "10309": [("121", "Back to development", "3")],
    "10310": [("131", "Start acceptance", "10311")],
    "10311": [("141", "Accept", "10313"), ("142", "Reject", "10312")],
    "10312": [("151", "Back to development", "3"), ("152", "Back to supplier", "10302")],
    "10313": [("161", "Ready for release", "10314")],
    "10314": [("171", "Release", "10001")],
    "10001": [("181", "Reopen", "1")],
}
MAIN_LINE = (
    "1", "10300", "10301", "10302", "10303", "3", "10304", "10305", "10306", "10307", "10308", "10310", "10311",
    "10313", "10314", "10001",
)
DONE_STATUS = "10001"
DEV_STATUS = "3"
REVIEW_STATUS = "10304"
HANDOVER_STATUS = "10307"
QA_STATUSES = ("10307", "10308")
TESTER_STATUSES = ("10308", "10309", "10310")
# The business side moves the issue until the supplier takes it, then accepts and releases it.
REPORTER_STATUSES = ("10300", "10301", "10302", "10311", "10312", "10313", "10314", "10001")
REWORK = {"10304": ("3",), "10308": ("10309", "3"), "10311": ("10312", "3")}
DATE_STATUSES = {"10307": "deliveredAt", "10308": "installedAt", "10313": "acceptedAt"}

BOARD_ID = 7
SPRINT_ID = 57
SPRINT_NAME = "Passenger Platform Sprint 57"
SPRINT_GOAL = (
    "Open self-service rebooking to every market, and clear the acceptance backlog of the loyalty migration "
    "before the release freeze"
)
SPRINT_OWNER = "lucia"
PREVIOUS_SPRINT_ID = 56
PREVIOUS_SPRINT_NAME = "Passenger Platform Sprint 56"
SPRINT_LENGTH_DAYS = 14
# Contracted work is slow to cross the board: most issues were created weeks before the sprint.
CARRIED_AGE_DAYS = (10, 45)
FIX_VERSION = "R24.3"
CRITICALITY = {"Highest": "Blocking", "High": "Major", "Medium": "Minor", "Low": "Minor"}
COMPONENTS = {
    "booking": "Booking engine",
    "loyalty": "Loyalty",
    "payments": "Payments",
    "check-in": "Departure control",
    "partner-api": "Partner API",
    "batch": "Batch jobs",
    "mobile": "Mobile app",
    "web": "Web",
}
FLAGS = ("blocked", "regression", "business-question", "supplier-question", "security", "performance")

# Epic: (name, ghx-label colour, component labels, subjects of its issues).
EPIC_THEMES = (
    ("Self-service rebooking after a cancelled or heavily delayed flight", "ghx-label-4", ("booking", "web"),
     ("the rebooking offer", "the alternative flight list", "the rebooking confirmation e-mail",
      "the protected connection rule", "the rebooking fare difference")),
    ("Loyalty programme migration to the new points ledger", "ghx-label-6", ("loyalty", "batch"),
     ("the points balance", "the tier status", "the points expiry batch", "the partner accrual file",
      "the ledger reconciliation report")),
    ("Seat map and paid seat selection", "ghx-label-9", ("booking", "mobile", "web"),
     ("the seat map", "the extra legroom seat price", "the family seating rule", "the seat refund")),
    ("Online check-in for codeshare flights", "ghx-label-2", ("check-in", "partner-api"),
     ("the codeshare check-in window", "the boarding pass barcode", "the partner passenger record",
      "the travel document check")),
    ("Payment in instalments for long-haul bookings", "ghx-label-7", ("payments", "booking"),
     ("the instalment schedule", "the deposit amount", "the failed instalment retry", "the card token")),
    ("Baggage allowance and excess baggage purchase", "ghx-label-1", ("booking", "check-in"),
     ("the baggage allowance", "the excess baggage price", "the sports equipment option",
      "the baggage receipt")),
    ("Partner API version 3 for travel agencies", "ghx-label-5", ("partner-api",),
     ("the availability endpoint", "the order retrieval endpoint", "the agency rate limit",
      "the webhook signature")),
    ("Disruption notifications by text message and app push", "ghx-label-8", ("mobile", "batch"),
     ("the delay notification", "the gate change push", "the notification preferences",
      "the message template")),
    ("Accessibility of the booking funnel", "ghx-label-3", ("web", "mobile"),
     ("the passenger form", "the fare comparison table", "the date picker", "the error summary")),
    ("Refunds and travel vouchers", "ghx-label-10", ("payments", "batch"),
     ("the refund request", "the travel voucher balance", "the voucher expiry reminder",
      "the refund accounting export")),
    ("Data protection: retention and erasure of passenger data", "ghx-label-11", ("batch", "partner-api"),
     ("the erasure request", "the retention batch", "the passenger data export", "the consent log")),
    ("Performance of the fare search under peak load", "ghx-label-12", ("booking", "partner-api"),
     ("the fare search cache", "the availability fan-out", "the search timeout", "the price rounding")),
)
EPICS = tuple((name, color) for name, color, _, _ in EPIC_THEMES)

QUICK_FILTERS = (
    # One filter per person, as large teams often end up with, then filters on labels: a crowded header.
    *(
        {"id": 100 + index, "name": name.split()[0], "query": f"assignee = {login}", "description": ""}
        for index, (login, name) in enumerate(PEOPLE.items())
    ),
    {"id": 1, "name": "Only my issues", "query": "assignee = currentUser()", "description": ""},
    {"id": 2, "name": "Unassigned", "query": "assignee is EMPTY", "description": ""},
    {"id": 3, "name": "Bugs", "query": "issuetype = Bug", "description": ""},
    {"id": 4, "name": "Stories", "query": "issuetype = Story", "description": ""},
    {"id": 5, "name": "Blocked", "query": "labels = blocked", "description": "Waiting on someone else"},
    {"id": 6, "name": "Regressions", "query": "labels = regression", "description": ""},
    {"id": 7, "name": "Waiting for business", "query": "labels = business-question", "description": ""},
    {"id": 8, "name": "Waiting for supplier", "query": "labels = supplier-question", "description": ""},
    {"id": 9, "name": "Security", "query": "labels = security", "description": ""},
    {"id": 10, "name": "Performance", "query": "labels = performance", "description": ""},
    *(
        {"id": 20 + index, "name": name, "query": f"labels = {label}", "description": ""}
        for index, (label, name) in enumerate(COMPONENTS.items())
    ),
)

# ---------- Vocabulary of the generated issues ----------

STORY_VERBS = (
    "Show", "Recalculate", "Validate", "Store", "Expose", "Let the passenger change", "Send", "Log changes to",
    "Synchronise", "Display the history of", "Prevent duplicates in", "Pre-fill",
)
CONTEXTS = (
    "for passengers travelling with an infant", "when the booking was made by a travel agency",
    "for group bookings of more than nine passengers", "after a schedule change", "in the mobile app",
    "for codeshare segments", "when the payment is split between two cards", "for frequent flyers",
    "on multi-city itineraries", "when the flight is operated by a partner", "for unaccompanied minors",
    "in every supported language", "during the overnight batch window", "for bookings older than a year",
    "when the passenger name contains non-Latin characters",
)
BUG_SYMPTOMS = (
    "is computed twice", "shows the wrong currency", "is lost on page reload", "times out",
    "is not translated", "ignores the time zone of the departure airport", "rounds amounts the wrong way",
    "is sent twice", "is missing from the export", "accepts an expired date", "is empty",
)
TASK_VERBS = (
    "Add monitoring of", "Document the contract of", "Load test", "Clean the test data of",
    "Remove the feature flag of", "Archive the logs of",
)

# Rules and criteria of the specifications, about the issue's subject.
RULES = (
    "{subject} is computed on the server only; the client never sends an amount it computed itself.",
    "When the booking contains several passengers, {subject} applies to each of them separately.",
    "An infant on a lap inherits {subject} of the adult it travels with.",
    "{subject} follows the rules of the operating carrier when it differs from the marketing carrier.",
    "Amounts are expressed in the currency of the point of sale, rounded half up to two decimals.",
    "Every change to {subject} writes an entry in the booking history, with the channel that made it.",
    "If the reservation system does not answer within 8 seconds, the passenger sees the generic error page "
    "and the attempt is logged with its correlation id.",
    "{subject} is unavailable less than 3 hours before departure; the message explains why.",
    "Travel agencies see the same result as the web channel, without the marketing banners.",
    "The feature can be switched off per market from the back office without a deployment.",
    "The rule is evaluated again when the itinerary changes, never cached across itineraries.",
    "Passengers flagged as needing assistance keep their assistance request whatever happens to "
    "{subject}.",
    "No personal data appears in the logs: the booking reference and the passenger index are enough.",
    "An existing booking created before the go-live keeps its current behaviour until it is modified.",
    "{subject} is shown in the language of the booking, not the language of the browser.",
)
CRITERIA = (
    "Given a one-way booking for one adult, when {subject} is requested, then the answer arrives in under "
    "two seconds",
    "Given a booking with an infant, when {subject} changes, then the infant's record follows",
    "Given a codeshare flight, when {subject} is displayed, then the operating carrier's rule is used",
    "Given the feature is switched off for the market, when the passenger opens the page, then nothing "
    "changes from today",
    "Given a travel agency booking, when the agency calls the API, then the same values as the web are "
    "returned",
    "Given the reservation system is down, when {subject} is requested, then the generic error page is shown "
    "and nothing is charged",
    "Given a name with non-Latin characters, when {subject} is stored, then it is read back unchanged",
)
DATA_FIELDS = (
    ("bookingReference", "PNR", "6 characters, upper case"),
    ("passengerIndex", "PNR passenger list", "starts at 1"),
    ("segmentId", "Inventory", "unique per itinerary"),
    ("fareBasis", "Pricing", "as filed, never rewritten"),
    ("amount", "Pricing", "decimal, 2 digits"),
    ("currency", "Point of sale", "ISO 4217"),
    ("channel", "Session", "WEB, APP or AGENCY"),
    ("operatingCarrier", "Schedule", "IATA code"),
    ("createdAt", "Server clock", "UTC, ISO 8601"),
    ("tierLevel", "Loyalty ledger", "BASIC, SILVER, GOLD"),
)
QUESTIONS = (
    "Does the rule also apply to bookings made with miles?",
    "What should the call centre see when the passenger calls during the change?",
    "Is the partner carrier informed, or only our own systems?",
    "Which market goes first? The legal review is only done for two of them.",
    "Do we keep the old e-mail template for bookings made before the release?",
)
OUT_OF_SCOPE = (
    "Bookings made through the call centre tool: covered by a later change request.",
    "Changes to the loyalty statement e-mail.",
    "Charter flights, which do not go through the reservation system.",
)

# Comments: the specifications are discussed at length, often by people pasting assistant-written
# analyses into the thread.
COMMENT_OPENINGS = (
    "Analysis of the impact on {component}:",
    "Summary of the review of the last delivery:",
    "Test report from the staging run of this morning:",
    "Answer to the business question raised at the refinement:",
    "Proposal for the technical design, to be validated before we start:",
    "Root cause analysis:",
    "Estimation details for the change request:",
)
COMMENT_POINTS = (
    "the {component} reads {field} from the reservation system at every call, so a cache would hide "
    "schedule changes",
    "the current contract returns {field} as a string; changing it to a number breaks the agency clients",
    "{count} test cases out of 42 pass on staging, the failures all come from the same data set",
    "the batch processes about {count}0 000 records a night, well within the window",
    "the error comes from a time zone conversion: departure local time is compared with UTC",
    "the specification says {field} is mandatory, but the partner file leaves it empty for children",
    "the new endpoint keeps the old one alive for two releases, behind the same authentication",
    "the rounding differs between the web and the app because the app formats the amount itself",
    "a retry would double the charge: the payment provider does not support idempotency keys on this call",
    "the migration script is idempotent and can be run again if the window is too short",
    "the logs of the {component} show the same correlation id twice, so the call is made twice",
    "the screen follows the agreed mockup, except the error summary which moves above the form",
    "the accessibility checker reports no error, the screen reader test is still to be done",
)
COMMENT_CLOSINGS = (
    "Unless someone objects, we go on with this approach.",
    "Waiting for the business decision before going further.",
    "The fix is in the next delivery to staging.",
    "Moving the open points to a follow-up issue so this one can close.",
    "Can the business confirm the expected behaviour for the edge case above?",
    "Estimate updated accordingly: two more days on the supplier side.",
)
NOT_STARTED_OPENINGS = (
    "Refinement notes:",
    "First reading of the specification, questions before sending it to the supplier:",
    "Points raised by the architecture review:",
    "Dependencies identified so far:",
)
LIVE_COMMENT_TEMPLATES = (
    "Delivered to staging with build {count}.4.2, ready for supplier QA.",
    "Picking this one up after the daily.",
    "The business confirmed the expected behaviour by mail, specification updated.",
    "Found the cause: the partner file is read with the wrong encoding.",
    "Blocked by the reservation system maintenance tonight, retrying tomorrow morning.",
    "Acceptance test passed on two markets out of three, the third one is waiting for test data.",
    "Code review done, two minor remarks, nothing blocking.",
    "Estimation sent to the business: 5 days, including the migration script.",
)


def _upper_first(text):
    return text[:1].upper() + text[1:]


def _lower_first(text):
    return text[:1].lower() + text[1:]


def _paragraph(
        rng,
        subject
):
    """One analysis of a comment thread: an opening, three to six findings, a closing."""
    component = rng.choice(list(COMPONENTS.values()))
    points = [
        point.format(
            component=component,
            field="{{" + rng.choice(DATA_FIELDS)[0] + "}}",
            count=rng.randint(12, 41)
        )
        for point in rng.sample(
            COMMENT_POINTS,
            rng.randint(3, 6)
        )
    ]
    return "\n".join((
        rng.choice(COMMENT_OPENINGS).format(component=component),
        *(f"* {_upper_first(point)}." for point in points),
        f"Regarding {subject}: {_lower_first(rng.choice(COMMENT_CLOSINGS))}",
    ))


def _comments(
        name,
        count,
        openings=None
):
    rng = random.Random(f"{SEED}/{name}")
    subjects = [subject for *_, epic_subjects in EPIC_THEMES for subject in epic_subjects]
    comments = []
    for _ in range(count):
        # One to three analyses in a row: the long answers assistants write.
        text = "\n\n".join(
            _paragraph(rng, rng.choice(subjects))
            for _ in range(rng.choice((1, 1, 2, 3)))
        )
        if openings:
            text = rng.choice(openings) + "\n" + text.split("\n", 1)[1]
        comments.append(text)
    return tuple(comments)


GENERIC_COMMENTS = _comments("comments", 160)
NOT_STARTED_COMMENTS = _comments("not-started", 40, NOT_STARTED_OPENINGS)
LIVE_COMMENTS = tuple(
    text.format(count=number)
    for number, text in enumerate(LIVE_COMMENT_TEMPLATES, start=31)
)
COMMENT_COUNTS = (3, 5, 6, 7, 8, 10)
COMMENTS = {}
DESCRIPTIONS = {}

# ---------- The generated issues ----------

# Issues per status, in the order of the main line: a board with something in every column.
ISSUES_PER_STATUS = (30, 20, 18, 15, 15, 40, 18, 10, 12, 12, 25, 12, 25, 12, 10, 26)
POINTS = (1, 2, 3, 5, 8, 13, None)


def _summary(
        rng,
        kind,
        subject
):
    if kind == "Bug":
        return f"{_upper_first(subject[len('the '):])} {rng.choice(BUG_SYMPTOMS)} {rng.choice(CONTEXTS)}"
    if kind == "Task":
        return f"{rng.choice(TASK_VERBS)} {subject}"
    return f"{rng.choice(STORY_VERBS)} {subject} {rng.choice(CONTEXTS)}"


def _assignee(
        rng,
        status
):
    position = MAIN_LINE.index(status)
    if position < MAIN_LINE.index("10303"):
        return rng.choice((None, None) + REPORTERS) if status == "1" else rng.choice(REPORTERS)
    if position < MAIN_LINE.index(HANDOVER_STATUS):
        # The viewer gets a fair share of the development work: the "Only my issues" filter shows some.
        return ME if rng.random() < 0.15 else rng.choice(DEVELOPERS)
    if position < MAIN_LINE.index("10311"):
        return rng.choice((None,) + TESTERS)
    return rng.choice(REPORTERS)


def _generate_issues():
    rng = random.Random(SEED)
    summaries = set()
    issues = []
    for status, count in zip(MAIN_LINE, ISSUES_PER_STATUS):
        position = MAIN_LINE.index(status)
        for _ in range(count):
            epic, _, labels, subjects = rng.choice(EPIC_THEMES)
            kind = rng.choices(("Story", "Bug", "Task"), weights=(60, 25, 15))[0]
            subject = rng.choice(subjects)
            summary = _summary(rng, kind, subject)
            while summary in summaries:
                summary = _summary(rng, kind, subject)
            summaries.add(summary)
            flags = [flag for flag in FLAGS if rng.random() < (0.3 if flag == "regression" and kind == "Bug" else 0.06)]
            checks = [check for check in REWORK if check in MAIN_LINE[1:position + 1]]
            issues.append(dict(
                summary=summary,
                subject=subject,
                type=kind,
                priority=rng.choices(("Highest", "High", "Medium", "Low"), weights=(5, 25, 50, 20))[0],
                status=status,
                assignee=_assignee(rng, status),
                epic=epic if rng.random() < 0.85 else None,
                points=rng.choice(POINTS),
                labels=sorted(rng.sample(labels, rng.randint(1, len(labels)))) + flags,
                freshness=rng.choices(("recent", "yesterday", "older"), weights=(6, 18, 76))[0],
                carried=rng.random() < 0.75,
                reworked=tuple(rng.choice(checks) for _ in range(rng.choice((0, 0, 1, 1, 2, 3)))) if checks else (),
            ))
    # Links and attachments need a name for the issue: a few dozen get one.
    for number, issue in enumerate(rng.sample(issues, 60)):
        issue["detailed"] = f"pax-{number}"
    return tuple(issues)


ISSUES = _generate_issues()
# No sprint planned ahead: the supplier only plans the next sprint at the review.
FUTURE_SPRINTS = ()
FUTURE_ISSUES = ()
_DETAILED = [issue["detailed"] for issue in ISSUES if issue.get("detailed")]
LINKS = tuple(
    (_DETAILED[index], "blocks" if index % 3 == 0 else "relates to", _DETAILED[index + 1])
    for index in range(0, 40, 2)
)
ATTACHMENTS = {
    detailed: ((name, author),)
    for detailed, name, author in zip(
        _DETAILED[40:],
        (name for _ in range(10) for name in DRAWINGS),
        (author for _ in range(10) for author in REPORTERS)
    )
}


def default_description(spec):
    """A specification of a few screens, the same for the same issue at every start."""
    rng = random.Random(f"{SEED}/{spec['summary']}")
    subject = spec["subject"]
    attachment = ATTACHMENTS.get(spec.get("detailed"))
    if spec["type"] == "Bug":
        component = COMPONENTS[spec["labels"][0]] if spec["labels"][0] in COMPONENTS else "Booking engine"
        return "\n".join((
            "h3. Steps",
            "# Log in on staging with a test passenger of the GOLD tier",
            f"# Open a booking {rng.choice(CONTEXTS)}",
            f"# Look at {subject}",
            "h3. Expected",
            _upper_first(rng.choice(RULES).format(subject=subject)),
            "h3. Actual",
            f"{spec['summary']}.",
            "h3. Logs",
            "{code}",
            f"08:{rng.randint(10, 59)}:{rng.randint(10, 59)}.{rng.randint(100, 999)}Z ERROR [{component}] correlationId="
            f"{rng.getrandbits(64):016x}",
            f"  at pricing.{subject.split()[-1].capitalize()}Service.compute(line {rng.randint(40, 400)})",
            "  caused by: segment operated by partner, rule set not loaded",
            "{code}",
            "h3. Impact",
            f"About {rng.randint(2, 40)} complaints a week reach the call centre. No workaround for travel agencies.",
        ))
    lines = [
        "h3. Context",
        f"Today, {subject} is handled by the legacy back office, by hand, {rng.choice(CONTEXTS)}. The call "
        f"centre receives questions about it every day, and the agencies ask for the same through the API.",
        f"This change belongs to the epic *{spec['epic'] or 'Run'}*, and must be accepted before the release "
        f"freeze of {FIX_VERSION}.",
        "h3. Business rules",
        *(f"# {_upper_first(rule.format(subject=subject))}" for rule in rng.sample(RULES, rng.randint(8, 14))),
        "h3. Data",
        "||Field||Source||Rule||",
        *(f"|{{{{{field}}}}}|{source}|{rule}|" for field, source, rule in rng.sample(DATA_FIELDS, rng.randint(4, 7))),
    ]
    if "partner-api" in spec["labels"] or spec["type"] == "Task":
        lines += [
            "h3. Interface",
            "{code}",
            "{",
            f'  "bookingReference": "{"".join(rng.choice("ABCDEFGHJKLMNPRSTUVWXYZ") for _ in range(6))}",',
            '  "passengers": [{"passengerIndex": 1, "type": "ADT"}],',
            f'  "amount": {rng.randint(20, 900)}.{rng.randint(0, 99):02d},',
            '  "currency": "EUR",',
            '  "channel": "AGENCY"',
            "}",
            "{code}",
        ]
    if attachment:
        lines += ["h3. Mockup", f"!{attachment[0][0]}!"]
    lines += [
        "h3. Acceptance criteria",
        *(f"* {criterion.format(subject=subject)}" for criterion in rng.sample(CRITERIA, rng.randint(4, 6))),
        "h3. Out of scope",
        *(f"* {item}" for item in rng.sample(OUT_OF_SCOPE, 2)),
        "h3. Open questions",
        *(f"* {question}" for question in rng.sample(QUESTIONS, rng.randint(1, 3))),
    ]
    return "\n".join(lines)
