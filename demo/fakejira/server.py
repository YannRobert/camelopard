"""A fake Jira Server, answering the requests Jirafe makes with the fictional board of a scenario.

Only what Jirafe reads and writes is served: anything else gets a 404, which shows at once when Jirafe starts
using a new endpoint. Any bearer token is accepted.
"""
import json
import random
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from . import icons
from .board import Board, JiraRefusal

ISSUE_PATH = re.compile(r"^/rest/api/2/issue/([A-Z][A-Z0-9]+-[0-9]+)\Z")
ASSIGNEE_PATH = re.compile(r"^/rest/api/2/issue/([A-Z][A-Z0-9]+-[0-9]+)/assignee\Z")
TRANSITIONS_PATH = re.compile(r"^/rest/api/2/issue/([A-Z][A-Z0-9]+-[0-9]+)/transitions\Z")
SPRINT_ISSUES_PATH = re.compile(r"^/rest/agile/1\.0/board/[0-9]+/sprint/([0-9]+)/issue\Z")
ACTIVE_SPRINTS_PATH = re.compile(r"^/rest/agile/1\.0/board/[0-9]+/sprint\Z")
ICON_PATH = re.compile(r"^/images/icons/demo/([a-z]+\.svg)\Z")
ATTACHMENT_PATH = re.compile(r"^/secure/attachment/([0-9]+)/([\w.-]+)\Z")
BROWSE_PATH = re.compile(r"^/browse/([A-Z][A-Z0-9]+-[0-9]+)\Z")
DEFAULT_PAGE_SIZE = 50
MAX_BODY_BYTES = 4096
# A simulated change lands within this fraction of the interval around it: changes do not tick like a clock.
ACTIVITY_JITTER = 0.4


class FakeJiraServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
            self,
            port,
            scenario
    ):
        super().__init__(
            ("127.0.0.1", port),
            FakeJiraHandler
        )
        self.base_url = f"http://127.0.0.1:{self.server_address[1]}"
        self.board = Board(
            self.base_url,
            scenario
        )
        self.quiet = False


class FakeJiraHandler(BaseHTTPRequestHandler):

    # Jirafe keeps its connections to Jira open: every response carries its Content-Length.
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        target = urlsplit(self.path)
        path, query = unquote(target.path), parse_qs(target.query)
        board = self.server.board
        if self.answer_page(path):
            return
        if not self.authenticated():
            return
        try:
            if path == "/rest/greenhopper/1.0/xboard/work/allData.json":
                self.send_json(200, board.all_data(first(query, "activeQuickFilters")))
            elif path == "/rest/greenhopper/1.0/rapidviewconfig/editmodel.json":
                self.send_json(200, board.edit_model())
            elif path == "/rest/api/2/myself":
                self.send_json(200, board.myself())
            elif path == "/rest/api/2/user/assignable/search":
                self.send_json(200, board.assignable(first(query, "username") or ""))
            elif ACTIVE_SPRINTS_PATH.match(path):
                self.send_json(200, board.active_sprints())
            elif SPRINT_ISSUES_PATH.match(path):
                self.send_json(
                    200,
                    board.sprint_issues(
                        int(SPRINT_ISSUES_PATH.match(path).group(1)),
                        field_list(query),
                        int(first(query, "startAt") or 0),
                        int(first(query, "maxResults") or DEFAULT_PAGE_SIZE)
                    )
                )
            elif path == "/rest/api/2/search":
                self.send_json(
                    200,
                    board.search(
                        first(query, "jql") or "",
                        field_list(query),
                        first(query, "expand") or "",
                        int(first(query, "startAt") or 0),
                        int(first(query, "maxResults") or DEFAULT_PAGE_SIZE)
                    )
                )
            elif ISSUE_PATH.match(path):
                self.send_json(
                    200,
                    board.issue(
                        ISSUE_PATH.match(path).group(1),
                        field_list(query),
                        first(query, "expand") or ""
                    )
                )
            else:
                self.not_served()
        except JiraRefusal as refusal:
            self.send_json(404 if "Does Not Exist" in str(refusal) else 400, refusal.body)

    def answer_page(self, path):
        """Images and browse links, which a browser asks for without the token. True when answered."""
        icon = ICON_PATH.match(path)
        attachment = ATTACHMENT_PATH.match(path)
        browse = BROWSE_PATH.match(path)
        if icon:
            self.send_image(icons.icon(icon.group(1)))
        elif attachment:
            self.send_image(self.server.board.attachment(*attachment.groups()))
        elif browse:
            self.send_body(
                200,
                BROWSE_PAGE.format(key=browse.group(1)).encode(),
                "text/html; charset=utf-8"
            )
        else:
            return False
        return True

    def do_PUT(self):
        path = urlsplit(self.path).path
        board = self.server.board
        assignee = ASSIGNEE_PATH.match(path)
        if assignee:
            self.write(lambda body: board.assign(
                assignee.group(1),
                body["name"]
            ))
        elif path == "/rest/agile/1.0/issue/rank":
            self.write(lambda body: board.rank(
                body["issues"][0],
                before=body.get("rankBeforeIssue"),
                after=body.get("rankAfterIssue")
            ))
        else:
            self.not_served()

    def do_POST(self):
        transitions = TRANSITIONS_PATH.match(urlsplit(self.path).path)
        if transitions:
            self.write(lambda body: self.server.board.transition(
                transitions.group(1),
                str(body["transition"]["id"])
            ))
        else:
            self.not_served()

    def write(self, apply):
        """Applies a write to the board with the JSON body sent: 204 as Jira, or Jira's 400."""
        if not self.authenticated():
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length)) if 0 < length <= MAX_BODY_BYTES else None
        except ValueError:
            body = None
        if not isinstance(body, dict):
            self.send_json(400, {"errorMessages": ["expected a JSON object"], "errors": {}})
            return
        try:
            apply(body)
        except JiraRefusal as refusal:
            self.send_json(400, refusal.body)
            return
        except (KeyError, IndexError, TypeError):
            self.send_json(400, {"errorMessages": ["unexpected body"], "errors": {}})
            return
        self.send_body(204, b"", None)

    def not_served(self):
        self.send_json(404, {"errorMessages": [f"Not served by the demo Jira: {self.command} {self.path}"]})

    def authenticated(self):
        if self.headers.get("Authorization", "").startswith("Bearer "):
            return True
        self.send_json(401, {"errorMessages": ["You are not authenticated: any bearer token will do."]})
        return False

    def send_image(self, svg):
        if svg is None:
            self.send_json(404, {"errorMessages": ["no such image"]})
        else:
            self.send_body(200, svg, "image/svg+xml")

    def send_json(
            self,
            status,
            payload
    ):
        self.send_body(
            status,
            json.dumps(payload).encode(),
            "application/json;charset=UTF-8"
        )

    def send_body(
            self,
            status,
            body,
            content_type
    ):
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(
            self,
            fmt,
            *args
    ):
        if not self.server.quiet:
            super().log_message(fmt, *args)


def first(
        query,
        name
):
    return query.get(name, [None])[0]


def field_list(query):
    fields = first(query, "fields")
    return None if not fields or fields in ("*all", "*navigable") else set(fields.split(","))


def simulate_colleagues(
        server,
        interval_s
):
    """Changes made by other people at random intervals: what Jirafe's live refresh and notifications show."""
    rng = random.Random()
    while True:
        time.sleep(interval_s * rng.uniform(1 - ACTIVITY_JITTER, 1 + ACTIVITY_JITTER))
        what = server.board.simulate(rng)
        if what:
            print(f"[demo Jira] {what}", flush=True)


def start(
        port,
        scenario,
        activity_s,
        quiet
):
    """Starts the fake Jira in background threads; returns the server (its base_url, its board)."""
    server = FakeJiraServer(
        port,
        scenario
    )
    server.quiet = quiet
    threading.Thread(
        target=server.serve_forever,
        daemon=True
    ).start()
    if activity_s > 0:
        threading.Thread(
            target=simulate_colleagues,
            args=(server, activity_s),
            daemon=True
        ).start()
    return server


BROWSE_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{key} · demo Jira</title>
<style>body{{font-family:sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#172b4d}}</style></head>
<body><h1>{key}</h1><p>This issue lives in Jirafe's demo Jira: a fake Jira Server with a fictional team and
board, made for trying Jirafe out. There is no Jira page to show it.</p></body></html>
"""
