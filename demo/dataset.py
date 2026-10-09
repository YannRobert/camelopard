"""The fictional team, workflow and issues of the demo board.

Everything here is invented: Folio is an imaginary online bookshop, and its team does not exist. Dates are
not stored: board.py places every event relative to the moment the demo starts, so that the board always
looks alive (moves yesterday for the stand-up, changes in the last hour, comments of the day).
"""

PROJECT_KEY = "FOL"
PROJECT_NAME = "Folio"
BOARD_NAME = "Folio team board"
FIRST_ISSUE_NUMBER = 101

# The person looking at the board (GET rest/api/2/myself).
ME = "alice"

PEOPLE = {
    "alice": "Alice Bernard",
    "bruno": "Bruno Costa",
    "chloe": "Chloé Dubois",
    "dmitri": "Dmitri Ivanov",
    "emma": "Emma Schultz",
    "farid": "Farid Haddad",
    "grace": "Grace Okafor",
}
DEVELOPERS = ("alice", "bruno", "chloe", "dmitri", "farid")
TESTERS = ("emma", "grace")
# History entries made by this account show as automation in the detail panel.
BOT = ("automation", "Jira Automation")

# Status id: (name, status category key). The ids look like Jira's: the board's own statuses are low, the
# ones a workflow adds are 10000 and above.
STATUSES = {
    "1": ("To Do", "new"),
    "3": ("In Progress", "indeterminate"),
    "10100": ("Code Review", "indeterminate"),
    "10101": ("Ready for QA", "indeterminate"),
    "10102": ("In QA", "indeterminate"),
    "10001": ("Done", "done"),
}
# Board columns, left to right: (name, status ids).
COLUMNS = (
    ("To Do", ("1",)),
    ("In Progress", ("3",)),
    ("Code Review", ("10100",)),
    ("Ready for QA", ("10101",)),
    ("In QA", ("10102",)),
    ("Done", ("10001",)),
)
# From status: [(transition id, transition name, to status)]. To Do only reaches Done through every other
# status: dropping a card from the first column on the last one shows Jirafe walking the workflow.
WORKFLOW = {
    "1": [("11", "Start progress", "3")],
    "3": [("21", "Request review", "10100"), ("31", "Stop progress", "1")],
    "10100": [("41", "Approve", "10101"), ("51", "Request changes", "3")],
    "10101": [("61", "Start testing", "10102")],
    "10102": [("71", "Pass", "10001"), ("81", "Fail", "3")],
    "10001": [("91", "Reopen", "1")],
}
# The usual way forward, used to write the history of an issue up to its current status.
MAIN_LINE = ("1", "3", "10100", "10101", "10102", "10001")
DONE_STATUS = "10001"

# Type id: (name, icon file served under images/icons/demo/).
TYPES = {
    "10001": ("Story", "story.svg"),
    "1": ("Bug", "bug.svg"),
    "3": ("Task", "task.svg"),
}
TYPE_IDS = {name: type_id for type_id, (name, _) in TYPES.items()}
PRIORITIES = {
    "1": ("Highest", "highest.svg"),
    "2": ("High", "high.svg"),
    "3": ("Medium", "medium.svg"),
    "4": ("Low", "low.svg"),
}
PRIORITY_IDS = {name: priority_id for priority_id, (name, _) in PRIORITIES.items()}

# Custom fields, as the demo configuration maps them to roles.
FIELDS = {
    "storyPoints": "customfield_10002",
    "sprints": "customfield_10004",
    "criticality": "customfield_10200",
    "developer": "customfield_10201",
    "tester": "customfield_10202",
    "environments": "customfield_10203",
    "deliveredAt": "customfield_10204",
    "installedAt": "customfield_10205",
    "acceptedAt": "customfield_10206",
}

BOARD_ID = 1
SPRINT_ID = 23
SPRINT_NAME = "Folio Sprint 23"
SPRINT_GOAL = "Ship the new checkout to 10% of customers"
# Starts and closes the sprints: the history of carried-over issues shows their name.
SPRINT_OWNER = "grace"
PREVIOUS_SPRINT_ID = 22
PREVIOUS_SPRINT_NAME = "Folio Sprint 22"
SPRINT_LENGTH_DAYS = 14
FIX_VERSION = "2.4.0"

# Key suffix: (name, ghx-label colour of Jira's palette). Epics are not on the board, only their label.
EPICS = (
    ("Checkout revamp", "ghx-label-4"),
    ("Search relevance", "ghx-label-6"),
    ("Mobile app", "ghx-label-9"),
    ("Accessibility", "ghx-label-2"),
    ("Payments v2", "ghx-label-7"),
)

QUICK_FILTERS = (
    # The page evaluates assignee filters itself; the others are asked to Jira (here, filter() in board.py).
    # Teams usually add one filter per person, named after their first name.
    *(
        {"id": 11 + index, "name": name.split()[0], "query": f"assignee = {login}", "description": ""}
        for index, (login, name) in enumerate(PEOPLE.items())
    ),
    {"id": 1, "name": "Only my issues", "query": "assignee = currentUser()", "description": ""},
    {"id": 2, "name": "Unassigned", "query": "assignee is EMPTY", "description": ""},
    {"id": 3, "name": "Bugs", "query": "issuetype = Bug", "description": "Every bug of the sprint"},
    {"id": 4, "name": "Blocked", "query": "labels = blocked", "description": "Waiting on someone else"},
)

# The sprint, in board order (rank). Freshness says when the issue last moved: "recent" within the last
# two hours (coloured edge on the card), "yesterday" on the previous working day (stand-up), "older" before.
# Carried: the issue comes from the previous sprint. Reworked: the code review sent it back once. Points: None when not estimated.
ISSUES = (
    # To Do
    dict(summary="Show the delivery estimate on the basket page", type="Story", priority="Medium", status="1",
         assignee=None, epic="Checkout revamp", points=3, labels=["frontend"], freshness="older"),
    dict(summary="Gift wrapping option at checkout", type="Story", priority="Low", status="1",
         assignee=None, epic=None, points=5, labels=["frontend", "backend"], freshness="older"),
    dict(summary="Search returns no result for ISBNs with dashes", type="Bug", priority="High", status="1",
         assignee="dmitri", epic=None, points=2, labels=["backend"], freshness="yesterday"),
    dict(summary="Keyboard focus is lost after closing the cart drawer", type="Bug", priority="Medium",
         status="1", assignee=None, epic="Accessibility", points=1, labels=["frontend", "a11y"],
         freshness="older"),
    dict(summary="Upgrade the image CDN client", type="Task", priority="Low", status="1", assignee="farid",
         epic=None, points=None, labels=["tech-debt"], freshness="older"),
    dict(summary="Push notification when a pre-order ships", type="Story", priority="Medium", status="1",
         assignee=None, epic="Mobile app", points=8, labels=["mobile"], freshness="older", carried=True),
    # In Progress
    dict(summary="Pay with a saved card in one tap", type="Story", priority="High", status="3",
         assignee="alice", epic="Payments v2", points=8, labels=["frontend", "backend"], freshness="yesterday",
         carried=True, detailed="saved-card"),
    dict(summary="Boost exact title matches in search results", type="Story", priority="High", status="3",
         assignee="dmitri", epic="Search relevance", points=5, labels=["backend"], freshness="recent",
         detailed="title-boost"),
    dict(summary="Order history screen on Android", type="Story", priority="Medium", status="3",
         assignee="chloe", epic="Mobile app", points=5, labels=["mobile"], freshness="yesterday"),
    dict(summary="Card declined message is shown in English to every customer", type="Bug",
         priority="Highest", status="3", assignee="bruno", epic="Payments v2", points=2,
         labels=["backend", "blocked"], freshness="recent", detailed="declined-message"),
    dict(summary="Remove the legacy coupon service", type="Task", priority="Low", status="3",
         assignee="farid", epic=None, points=3, labels=["tech-debt", "backend"], freshness="older"),
    dict(summary="Screen reader announces prices twice", type="Bug", priority="Medium", status="3",
         assignee="alice", epic="Accessibility", points=2, labels=["frontend", "a11y"], freshness="recent"),
    # Code Review
    dict(summary="Address autocomplete on the delivery form", type="Story", priority="High", status="10100",
         assignee="chloe", epic="Checkout revamp", points=5, labels=["frontend"], freshness="recent",
         reworked=True, detailed="autocomplete"),
    dict(summary="Index author pen names", type="Story", priority="Medium", status="10100",
         assignee="dmitri", epic="Search relevance", points=3, labels=["backend"], freshness="yesterday"),
    dict(summary="Retry webhook deliveries with backoff", type="Task", priority="Medium", status="10100",
         assignee="bruno", epic=None, points=3, labels=["backend", "api"], freshness="older"),
    dict(summary="Contrast of the \"Add to basket\" button", type="Bug", priority="Low", status="10100",
         assignee="alice", epic="Accessibility", points=1, labels=["frontend", "a11y"], freshness="yesterday"),
    # Ready for QA
    dict(summary="Split the checkout into three steps", type="Story", priority="High", status="10101",
         assignee="grace", epic="Checkout revamp", points=8, labels=["frontend"], freshness="yesterday",
         carried=True, reworked=True, detailed="three-steps"),
    dict(summary="Wishlist sync between web and mobile", type="Story", priority="Medium", status="10101",
         assignee="emma", epic="Mobile app", points=5, labels=["mobile", "api"], freshness="older"),
    dict(summary="Discount code accepted after expiry", type="Bug", priority="High", status="10101",
         assignee=None, epic=None, points=2, labels=["backend"], freshness="recent"),
    # In QA
    dict(summary="Apple Pay on the product page", type="Story", priority="High", status="10102",
         assignee="emma", epic="Payments v2", points=8, labels=["frontend", "mobile"], freshness="recent",
         detailed="apple-pay"),
    dict(summary="Typo tolerance for author names", type="Story", priority="Medium", status="10102",
         assignee="grace", epic="Search relevance", points=5, labels=["backend"], freshness="yesterday"),
    dict(summary="Skip link to the main content", type="Story", priority="Low", status="10102",
         assignee="emma", epic="Accessibility", points=1, labels=["frontend", "a11y"], freshness="older"),
    # Done
    dict(summary="Basket badge shows the wrong count after login", type="Bug", priority="High",
         status="10001", assignee="chloe", epic=None, points=2, labels=["frontend"],
         freshness="yesterday", reworked=True),
    dict(summary="Dark mode for the reading list", type="Story", priority="Low", status="10001",
         assignee="farid", epic="Mobile app", points=3, labels=["mobile"], freshness="older"),
    dict(summary="Log payment provider latency", type="Task", priority="Medium", status="10001",
         assignee="bruno", epic=None, points=2, labels=["backend"], freshness="older"),
    dict(summary="Synonyms for genres (sci-fi, science fiction)", type="Story", priority="Medium",
         status="10001", assignee="dmitri", epic="Search relevance", points=3, labels=["backend"],
         freshness="yesterday"),
    dict(summary="Alt text on cover images", type="Story", priority="Medium", status="10001",
         assignee="alice", epic="Accessibility", points=2, labels=["frontend", "a11y"], freshness="older"),
)

# Descriptions in Jira's wiki markup (a small subset: board.py renders it). Issues without one get a
# description built from their type.
DESCRIPTIONS = {
    "saved-card": (
        "h3. Why\n"
        "Returning customers type their card number again at every order: 31% of them leave at that step.\n"
        "h3. What\n"
        "* Offer the cards saved with the payment provider, the last one used first\n"
        "* One tap pays, with the security code only when the bank asks for it\n"
        "* A saved card can be removed from the account page\n"
        "h3. Out of scope\n"
        "Saving a card from the mobile app: see the *Mobile app* epic.\n"
        "!checkout-mockup.svg!"
    ),
    "title-boost": (
        "Searching for _The Hobbit_ shows three study guides before the book itself.\n"
        "h3. Acceptance criteria\n"
        "* An exact title match comes first, whatever the sales ranking\n"
        "* Articles are ignored: _Hobbit_ matches _The Hobbit_\n"
        "* The relevance dashboard shows no drop on the 200 reference queries"
    ),
    "declined-message": (
        "When the bank declines a card, the message comes from the payment provider and is not translated.\n"
        "h3. Steps\n"
        "# Switch the shop to German\n"
        "# Pay with the test card {{4000 0000 0000 0002}}\n"
        "# The message reads _Your card was declined._\n"
        "h3. Expected\n"
        "The message in the customer's language, from our own translations.\n"
        "Blocked: the provider sends no stable error code yet, ticket opened on their side."
    ),
    "autocomplete": (
        "Suggest the address while the customer types it, from the postcode API already used by the "
        "warehouse.\n"
        "* At least 3 characters before suggesting\n"
        "* The customer can still type an address the API does not know\n"
        "* No request is sent for the house number alone"
    ),
    "three-steps": (
        "h3. Why\n"
        "The single checkout page is long on mobile and its errors show far from the field at fault.\n"
        "h3. What\n"
        "# Delivery\n"
        "# Payment\n"
        "# Review and confirm\n"
        "Each step keeps what was typed when going back. Behind the {{checkout-steps}} feature flag."
    ),
    "apple-pay": (
        "Pay for a single book from its page, without going through the basket.\n"
        "* Only on Safari and iOS, where Apple Pay is available\n"
        "* Shipping options and costs come from the same API as the checkout\n"
        "!apple-pay-flow.svg!"
    ),
}

# Comments by issue (detailed key): (author, text). Other issues draw from GENERIC_COMMENTS.
COMMENTS = {
    "saved-card": (
        ("bruno", "The provider's vault API is ready on staging, the token comes back in the payment response."),
        ("grace", "Should we test with an expired saved card? I can prepare the test data."),
        ("alice", "Yes please, expired and blocked cards both. I'll handle the expiry message."),
    ),
    "declined-message": (
        ("bruno", "Provider support answered: error codes in the response by the end of the month."),
        ("farid", "Meanwhile we could map the five most common English messages, they never change."),
    ),
    "autocomplete": (
        ("dmitri", "Left a few comments on the merge request, mostly about debouncing."),
        ("chloe", "Fixed, and the requests are now cancelled when the customer keeps typing."),
    ),
    "three-steps": (
        ("emma", "Going back from step 3 to step 1 loses the delivery slot on Firefox."),
        ("chloe", "Good catch, fixed in the last build."),
    ),
    "apple-pay": (
        ("emma", "Works on iOS 18 and macOS Safari. Testing the shipping change sheet now."),
    ),
}
GENERIC_COMMENTS = (
    "Merged, deployed on staging.",
    "I paired with Dmitri on this one, the tricky part is the cache invalidation.",
    "Can we keep the old behaviour behind a flag for a sprint?",
    "Tested on staging, looks good to me.",
    "The design is in the Figma file, page \"Checkout v2\".",
    "Product confirmed: no change needed on the emails.",
    "Rebased on main, the build is green again.",
)
# Comments on an issue nobody has started: the ones above talk about work already done.
NOT_STARTED_COMMENTS = (
    "Do we have the designs for this one?",
    "Estimated at the refinement, we can split it if needed.",
    "Product wants this before the next marketing campaign.",
)
# What a colleague says when the demo simulates activity.
LIVE_COMMENTS = (
    "Picking this one up after lunch.",
    "Deployed on staging, ready to be tested.",
    "Found the cause: a timezone issue in the date parsing.",
    "Can someone review this before the stand-up tomorrow?",
    "Moved the edge cases to a follow-up issue.",
)

ATTACHMENTS = {
    # Detailed key: [(file name, author)]
    "saved-card": (("checkout-mockup.svg", "chloe"),),
    "apple-pay": (("apple-pay-flow.svg", "emma"),),
}

LINKS = (
    # (from detailed key, link name, to detailed key): the outward side reads "<from> blocks <to>".
    ("declined-message", "blocks", "saved-card"),
    ("three-steps", "relates to", "autocomplete"),
)
