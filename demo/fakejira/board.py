"""State of the demo Jira: the sprint's issues, their history, and the changes made to them.

Built once at startup from a scenario's dataset, every date placed relative to that moment, then changed by the page's
writes (rank, assignee, transitions) and by the simulated colleagues. Answers in the shape of Jira Server's
JSON, limited to what Jirafe reads.
"""
import html
import random
import re
import threading
from datetime import datetime, timedelta

from . import icons

# Same seed at every start: the board looks the same from one screenshot session to the next.
SEED = 2026
WORKDAY_START_H = 9
WORKDAY_END_H = 18
# A "recent" move happened that many minutes ago, at most: within the default recentMinutes (120).
RECENT_MAX_MIN = 100
RECENT_MIN_MIN = 4
MIN_SPRINT_AGE_DAYS = 3
FIRST_ISSUE_ID = 20100
FIRST_EPIC_NUMBER = 41
FIRST_EPIC_ID = 20000
FIRST_COMMENT_ID = 30000
FIRST_HISTORY_ID = 40000
FIRST_ATTACHMENT_ID = 50000
AVATAR_ID_BASE = 10100
JIRA_DATE = "%Y-%m-%dT%H:%M:%S.000%z"
# Sprint dates in allData.json, as the page parses them.
BOARD_DATE = "%d/%m/%Y %H:%M"
# As Jira Server renders a {code} block.
CODE_BLOCK = '<div class="code panel"><div class="codeContent panelContent"><pre class="code-java">{}</pre></div></div>'
LINK_TYPES = {
    "blocks": {"id": "10000", "name": "Blocks", "inward": "is blocked by", "outward": "blocks"},
    "relates to": {"id": "10003", "name": "Relates", "inward": "relates to", "outward": "relates to"},
}
KEY_IN = re.compile(r"^key in \(([A-Z0-9,-]+)\)\Z")
PERSON_FILTER = re.compile(r"^assignee = ([a-z]+)\Z")
LABEL_FILTER = re.compile(r"^labels = ([\w-]+)\Z")
TYPE_FILTER = re.compile(r"^issuetype = (\w+)\Z")
SPRINT_IN = re.compile(r"^sprint in \(([0-9,]+)\)( AND updated >= -([0-9]+)m)?\Z")


class JiraRefusal(Exception):
    """A write Jira would refuse: becomes a 400 with Jira's error body."""

    def __init__(
            self,
            messages,
            errors=None
    ):
        super().__init__("; ".join(messages))
        self.body = {"errorMessages": list(messages), "errors": errors or {}}


class Board:

    def __init__(
            self,
            base_url,
            scenario,
            now=None
    ):
        self.base = base_url
        # The scenario's dataset module: the board only knows the names every scenario defines.
        self.data = scenario
        self._lock = threading.RLock()
        # Draws of times, re-seeded for every issue (see _build_issue).
        self._clock = random.Random(SEED)
        now = now or datetime.now().astimezone()
        self._ids = {"comment": FIRST_COMMENT_ID, "history": FIRST_HISTORY_ID}
        # Sprints start on a Monday morning, the latest one at least MIN_SPRINT_AGE_DAYS ago: long enough
        # for a history.
        monday = now - timedelta(days=now.weekday())
        if (now - monday).days < MIN_SPRINT_AGE_DAYS:
            monday -= timedelta(days=7)
        self.sprint_start = monday.replace(
            hour=WORKDAY_START_H,
            minute=0,
            second=0,
            microsecond=0
        )
        self.sprint_end = self.sprint_start + timedelta(days=self.data.SPRINT_LENGTH_DAYS)
        self.epics = {
            name: {
                "id": FIRST_EPIC_ID + index,
                "key": f"{self.data.PROJECT_KEY}-{FIRST_EPIC_NUMBER + index}",
                "name": name,
                "color": color,
            }
            for index, (name, color) in enumerate(self.data.EPICS)
        }
        self.issues = [
            self._build_issue(
                index,
                spec,
                now
            )
            for index, spec in enumerate(self.data.ISSUES)
        ]
        self._link_issues()

    # ---------- Building the dataset ----------

    def _build_issue(
            self,
            index,
            spec,
            now
    ):
        # Two generators per issue, seeded by its position: who did what is drawn apart from when, so that
        # the content stays the same whatever the time of day the demo starts, since moving a time into
        # working hours takes more draws on some days than on others.
        rng = random.Random(f"{SEED}/{index}")
        self._clock = random.Random(f"{SEED}/{index}/time")
        clock = self._clock
        detailed = spec.get("detailed")
        status_index = self.data.MAIN_LINE.index(spec["status"])
        last_at = self._last_move_time(
            spec["freshness"],
            now
        )
        if spec.get("carried"):
            created = self.sprint_start - timedelta(days=clock.uniform(*self.data.CARRIED_AGE_DAYS))
        else:
            created = self.sprint_start - timedelta(hours=clock.uniform(1, 40))
        created = self._working(min(created, last_at - timedelta(hours=2)))
        developer = spec["assignee"] if spec["assignee"] in self.data.DEVELOPERS else rng.choice(self.data.DEVELOPERS)
        tester = spec["assignee"] if spec["assignee"] in self.data.TESTERS else rng.choice(self.data.TESTERS)
        issue = {
            "id": str(FIRST_ISSUE_ID + index),
            "key": f"{self.data.PROJECT_KEY}-{self.data.FIRST_ISSUE_NUMBER + index}",
            "detailed": detailed,
            "summary": spec["summary"],
            "type": self.data.TYPE_IDS[spec["type"]],
            "priority": self.data.PRIORITY_IDS[spec["priority"]],
            "status": self.data.MAIN_LINE[0],
            "assignee": None,
            "reporter": rng.choice(self.data.REPORTERS),
            "epic": self.epics[spec["epic"]] if spec["epic"] else None,
            "points": spec["points"],
            "labels": list(spec["labels"]),
            "sprints": [self.data.PREVIOUS_SPRINT_ID, self.data.SPRINT_ID] if spec.get("carried") else [self.data.SPRINT_ID],
            "created": created,
            "updated": created,
            "description": self.data.DESCRIPTIONS.get(detailed) or self.data.default_description(spec),
            "comments": [],
            "histories": [],
            "attachments": [],
            "links": [],
            "developer": None,
            "tester": None,
            "dates": {},
            "resolution": None,
            "resolutiondate": None,
            "duedate": (now + timedelta(days=2)).strftime("%Y-%m-%d") if spec["priority"] == "Highest" else None,
        }
        # Status moves along the main line, the last one at last_at, the others spread before it.
        moves = self._rework(
            self.data.MAIN_LINE[1:status_index + 1],
            spec.get("reworked")
        )
        review_status = self.data.REVIEW_STATUS
        reviewer = rng.choice([login for login in self.data.DEVELOPERS if login != developer])
        times = sorted(
            self._working(
                created + (last_at - created) * clock.uniform(0.15, 0.95),
                created
            )
            for _ in moves[:-1]
        ) + [last_at] if moves else []
        for status, at in zip(moves, times):
            author = tester if status in self.data.TESTER_STATUSES else developer
            if status in self.data.REPORTER_STATUSES:
                author = issue["reporter"]
            if status == self.data.DEV_STATUS and issue["status"] == review_status:
                author = reviewer
            elif status == self.data.DEV_STATUS:
                self._assign(
                    issue,
                    developer,
                    developer,
                    at
                )
            self._move(
                issue,
                status,
                author,
                at
            )
            if status == self.data.HANDOVER_STATUS:
                # Handed over to QA: to a tester, or to nobody when QA picks issues from the column.
                self._assign(
                    issue,
                    spec["assignee"],
                    developer,
                    at
                )
        if not moves and spec["assignee"]:
            self._assign(
                issue,
                spec["assignee"],
                spec["assignee"],
                last_at
            )
        elif moves and issue["assignee"] != spec["assignee"]:
            self._assign(
                issue,
                spec["assignee"],
                spec["assignee"] or developer,
                last_at
            )
        self._add_comments(
            issue,
            rng,
            created,
            now
        )
        for name, author in self.data.ATTACHMENTS.get(detailed, ()):
            issue["attachments"].append({
                "id": str(FIRST_ATTACHMENT_ID + len(issue["attachments"]) + index * 10),
                "filename": name,
                "author": author,
                "created": created + timedelta(hours=1),
            })
        if spec.get("carried"):
            # The previous sprint closed with the issue unfinished: Jira adds the next sprint to its field.
            self._history(
                issue,
                self.data.SPRINT_OWNER,
                self.sprint_start,
                [item(
                    "Sprint",
                    str(self.data.PREVIOUS_SPRINT_ID),
                    self.data.PREVIOUS_SPRINT_NAME,
                    f"{self.data.PREVIOUS_SPRINT_ID}, {self.data.SPRINT_ID}",
                    f"{self.data.PREVIOUS_SPRINT_NAME}, {self.data.SPRINT_NAME}"
                )]
            )
        issue["histories"].sort(key=lambda history: history["created"])
        if spec["type"] == "Bug":
            issue["criticality"] = self.data.CRITICALITY[spec["priority"]]
            issue["environments"] = ["Production"] if spec["priority"] in ("Highest", "High") else ["Staging"]
        return issue

    def _rework(
            self,
            moves,
            loops
    ):
        """The moves with the issue sent back at the checks named in loops (True: once, at the first check),
        then walked again up to the check: a review asking for changes, a failed test."""
        if loops is True:
            loops = next((check for check in self.data.REWORK if check in moves), ())
            loops = (loops,) if loops else ()
        walked = []
        line = self.data.MAIN_LINE
        for status in moves:
            walked.append(status)
            for _ in range((loops or ()).count(status)):
                back = self.data.REWORK[status]
                walked += back + line[line.index(back[-1]) + 1:line.index(status) + 1]
        return tuple(walked)

    def _last_move_time(
            self,
            freshness,
            now
    ):
        rng = self._clock
        if freshness == "recent":
            return now - timedelta(minutes=rng.uniform(RECENT_MIN_MIN, RECENT_MAX_MIN))
        day = previous_working_day(now)
        if freshness == "older":
            day = previous_working_day(day)
            day -= timedelta(days=rng.randint(0, 2))
            day = max(day, self.sprint_start)
        return day.replace(
            hour=rng.randint(WORKDAY_START_H, WORKDAY_END_H - 2),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59)
        )

    def _working(
            self,
            moment,
            floor=None
    ):
        """The moment moved back into working hours (a weekday, from 9 to 18), not before floor: nobody in
        the team works at night, the history should not suggest it."""
        day = previous_working_day(moment) if moment.hour < WORKDAY_START_H else moment
        while day.weekday() >= 5:
            day -= timedelta(days=1)
        if day != moment or day.hour >= WORKDAY_END_H:
            day = day.replace(
                hour=self._clock.randint(WORKDAY_START_H, WORKDAY_END_H - 1),
                minute=self._clock.randint(0, 59)
            )
        return max(day, floor + timedelta(minutes=5)) if floor else day

    def _add_comments(
            self,
            issue,
            rng,
            created,
            now
    ):
        detailed = issue["detailed"]
        if detailed in self.data.COMMENTS:
            comments = self.data.COMMENTS[detailed]
        else:
            comments = [
                (rng.choice(list(self.data.PEOPLE)), text)
                for text in rng.sample(
                    self.data.NOT_STARTED_COMMENTS if issue["status"] == self.data.MAIN_LINE[0] else self.data.GENERIC_COMMENTS,
                    rng.choice(self.data.COMMENT_COUNTS)
                )
            ]
        span = now - created
        times = sorted(
            self._working(
                created + span * self._clock.uniform(0.3, 0.97),
                created
            )
            for _ in comments
        )
        for (author, text), at in zip(comments, times):
            self._comment(
                issue,
                author,
                text,
                at
            )

    def _link_issues(self):
        by_detail = {issue["detailed"]: issue for issue in self.issues if issue["detailed"]}
        for origin, link, target in self.data.LINKS:
            by_detail[origin]["links"].append(("outward", link, by_detail[target]["key"]))
            by_detail[target]["links"].append(("inward", link, by_detail[origin]["key"]))

    # ---------- Changes ----------

    def _history(
            self,
            issue,
            author,
            at,
            items
    ):
        self._ids["history"] += 1
        issue["histories"].append({"id": str(self._ids["history"]), "author": author, "created": at, "items": items})
        issue["updated"] = max(issue["updated"], at)

    def _move(
            self,
            issue,
            status,
            author,
            at
    ):
        previous = issue["status"]
        issue["status"] = status
        self._history(
            issue,
            author,
            at,
            [item("status", previous, self._status_name(previous), status, self._status_name(status))]
        )
        role_dates = self.data.DATE_STATUSES
        if status in role_dates:
            issue["dates"][role_dates[status]] = at
        if status in (self.data.DEV_STATUS, self.data.REVIEW_STATUS):
            issue["developer"] = issue["developer"] or author
        if status in self.data.TESTER_STATUSES:
            issue["tester"] = author
        if status == self.data.DONE_STATUS:
            issue["resolution"], issue["resolutiondate"] = "Done", at
            self._history(
                issue,
                self.data.BOT[0],
                at,
                [item("resolution", None, None, "10000", "Done")]
            )
        elif previous == self.data.DONE_STATUS:
            issue["resolution"], issue["resolutiondate"] = None, None
            for role in role_dates.values():
                issue["dates"].pop(role, None)

    def _assign(
            self,
            issue,
            login,
            author,
            at
    ):
        previous = issue["assignee"]
        if previous == login:
            return
        issue["assignee"] = login
        self._history(
            issue,
            author,
            at,
            [item("assignee", previous, self.data.PEOPLE.get(previous), login, self.data.PEOPLE.get(login))]
        )

    def _comment(
            self,
            issue,
            author,
            text,
            at
    ):
        self._ids["comment"] += 1
        issue["comments"].append({"id": str(self._ids["comment"]), "author": author, "body": text, "created": at})
        issue["updated"] = max(issue["updated"], at)

    def rank(
            self,
            key,
            before=None,
            after=None,
            author=None
    ):
        author = author or self.data.ME
        with self._lock:
            issue = self._find(key)
            neighbour = self._find(before or after)
            self.issues.remove(issue)
            position = self.issues.index(neighbour) + (0 if before else 1)
            self.issues.insert(position, issue)
            self._history(
                issue,
                author,
                datetime.now().astimezone(),
                [item("Rank", None, "", None, "Ranked higher" if before else "Ranked lower")]
            )

    def assign(
            self,
            key,
            login,
            author=None
    ):
        author = author or self.data.ME
        with self._lock:
            issue = self._find(key)
            if login is not None and login not in self.data.PEOPLE:
                raise JiraRefusal([], {"assignee": f"User '{login}' does not exist."})
            self._assign(
                issue,
                login,
                author,
                datetime.now().astimezone()
            )

    def transition(
            self,
            key,
            transition_id,
            author=None
    ):
        author = author or self.data.ME
        with self._lock:
            issue = self._find(key)
            target = next((to for id_, _, to in self.data.WORKFLOW[issue["status"]] if id_ == transition_id), None)
            if target is None:
                raise JiraRefusal([
                    f"It seems that you have tried to perform a workflow operation ({transition_id}) that is not "
                    f"valid for the current state of this issue ({key})."
                ])
            self._move(
                issue,
                target,
                author,
                datetime.now().astimezone()
            )

    def comment(
            self,
            key,
            author,
            text
    ):
        with self._lock:
            self._comment(
                self._find(key),
                author,
                text,
                datetime.now().astimezone()
            )

    def simulate(self, rng):
        """One change by a colleague, as if someone else were using Jira: a move, a comment or an
        assignment. Returns what happened, for the log; None when nothing applied."""
        with self._lock:
            others = [login for login in self.data.PEOPLE if login != self.data.ME]
            developers = [login for login in self.data.DEVELOPERS if login != self.data.ME]
            open_issues = [issue for issue in self.issues if issue["status"] != self.data.DONE_STATUS]
            action = rng.choices(("move", "comment", "assign"), weights=(5, 4, 2))[0]
            if action == "assign":
                unassigned = [issue for issue in open_issues if issue["assignee"] is None]
                if unassigned:
                    issue = rng.choice(unassigned)
                    who = rng.choice(self.data.TESTERS if issue["status"] in self.data.QA_STATUSES else developers)
                    self.assign(issue["key"], who, who)
                    return f"{self.data.PEOPLE[who]} took {issue['key']}"
                action = "move"
            if action == "comment":
                # Often on the viewer's issues: they are the ones the notifications are about.
                mine = [issue for issue in open_issues if issue["assignee"] == self.data.ME]
                issue = rng.choice(mine if mine and rng.random() < 0.5 else open_issues)
                who = rng.choice([login for login in others if login != issue["assignee"]])
                self.comment(issue["key"], who, rng.choice(self.data.LIVE_COMMENTS))
                return f"{self.data.PEOPLE[who]} commented on {issue['key']}"
            movable = [issue for issue in open_issues if issue["assignee"] != self.data.ME]
            if not movable:
                return None
            issue = rng.choice(movable)
            # Mostly forward, sometimes back (changes requested, a failed test): the board does not only
            # drift to Done.
            transitions = self.data.WORKFLOW[issue["status"]]
            transition_id, name, target = transitions[1 if len(transitions) > 1 and rng.random() < 0.25 else 0]
            who = issue["assignee"] or rng.choice(self.data.TESTERS if target in self.data.TESTER_STATUSES else developers)
            self.transition(issue["key"], transition_id, who)
            if issue["assignee"] is None:
                self.assign(issue["key"], who, who)
            return f"{self.data.PEOPLE[who]} moved {issue['key']} to {self._status_name(target)} ({name})"

    def _find(self, key):
        issue = next((issue for issue in self.issues if issue["key"] == key), None)
        if issue is None:
            raise JiraRefusal(["Issue Does Not Exist"])
        return issue

    # ---------- Jira's answers ----------

    def all_data(self, quick_filter=None):
        """rest/greenhopper/1.0/xboard/work/allData.json: the board in one call."""
        with self._lock:
            now = datetime.now().astimezone()
            issues = [issue for issue in self.issues if quick_filter is None or self._matches(issue, quick_filter)]
            return {
                "rapidViewId": self.data.BOARD_ID,
                "columnsData": {
                    "columns": [
                        {"id": index + 1, "name": name, "statusIds": list(statuses)}
                        for index, (name, statuses) in enumerate(self.data.COLUMNS)
                    ],
                },
                "issuesData": {"issues": [self._board_issue(issue) for issue in issues]},
                "sprintsData": {
                    "sprints": [{
                        "id": self.data.SPRINT_ID,
                        "name": self.data.SPRINT_NAME,
                        "state": "ACTIVE",
                        "goal": self.data.SPRINT_GOAL,
                        "startDate": self.sprint_start.strftime(BOARD_DATE),
                        "endDate": self.sprint_end.strftime(BOARD_DATE),
                        "daysRemaining": working_days(now, self.sprint_end),
                    }],
                },
                "entityData": {
                    "types": {
                        type_id: {"typeName": name, "typeUrl": self._icon_url(file)}
                        for type_id, (name, file) in self.data.TYPES.items()
                    },
                    "priorities": {
                        priority_id: {"priorityName": name, "priorityUrl": self._icon_url(file)}
                        for priority_id, (name, file) in self.data.PRIORITIES.items()
                    },
                    "statuses": {
                        status_id: {"statusName": name, "status": self._status(status_id)}
                        for status_id, (name, _) in self.data.STATUSES.items()
                    },
                    "epics": {
                        str(epic["id"]): {
                            "epicField": {
                                "id": "customfield_10008",
                                "label": "Epic",
                                "epicKey": epic["key"],
                                "text": epic["name"],
                                "epicColor": epic["color"],
                            },
                        }
                        for epic in self.epics.values()
                    },
                },
            }

    def edit_model(self):
        """rest/greenhopper/1.0/rapidviewconfig/editmodel.json: the board's name and quick filters."""
        return {
            "id": self.data.BOARD_ID,
            "name": self.data.BOARD_NAME,
            "quickFilterConfig": {"quickFilters": [dict(f) for f in self.data.QUICK_FILTERS]},
        }

    def active_sprints(self):
        return {
            "maxResults": 50,
            "startAt": 0,
            "isLast": True,
            "values": [{
                "id": self.data.SPRINT_ID,
                "state": "active",
                "name": self.data.SPRINT_NAME,
                "startDate": self.sprint_start.isoformat(timespec="milliseconds"),
                "endDate": self.sprint_end.isoformat(timespec="milliseconds"),
                "originBoardId": self.data.BOARD_ID,
                "goal": self.data.SPRINT_GOAL,
            }],
        }

    def sprint_issues(
            self,
            sprint_id,
            fields,
            start,
            size
    ):
        """rest/agile/1.0/board/<id>/sprint/<id>/issue: one page of the sprint's issues."""
        with self._lock:
            issues = [issue for issue in self.issues if sprint_id in issue["sprints"]]
            return {
                "startAt": start,
                "maxResults": size,
                "total": len(issues),
                "issues": [
                    self.issue_json(issue, fields, ())
                    for issue in issues[start:start + size]
                ],
            }

    def search(
            self,
            jql,
            fields,
            expand,
            start,
            size
    ):
        """rest/api/2/search, for the queries Jirafe's background sync makes, nothing more."""
        with self._lock:
            keys = KEY_IN.match(jql)
            sprints = SPRINT_IN.match(jql)
            if keys:
                wanted = keys.group(1).split(",")
                issues = [issue for issue in self.issues if issue["key"] in wanted]
            elif sprints:
                sprint_ids = {int(sprint) for sprint in sprints.group(1).split(",")}
                issues = [issue for issue in self.issues if sprint_ids & set(issue["sprints"])]
                if sprints.group(3):
                    since = datetime.now().astimezone() - timedelta(minutes=int(sprints.group(3)))
                    issues = [issue for issue in issues if issue["updated"] >= since]
            else:
                raise JiraRefusal([f"The demo Jira only understands the queries Jirafe makes, not: {jql}"])
            return {
                "startAt": start,
                "maxResults": size,
                "total": len(issues),
                "issues": [
                    self.issue_json(issue, fields, expand)
                    for issue in issues[start:start + size]
                ],
            }

    def issue(
            self,
            key,
            fields,
            expand
    ):
        with self._lock:
            return self.issue_json(
                self._find(key),
                fields,
                expand
            )

    def myself(self):
        return self._user(self.data.ME)

    def assignable(self, query):
        """Users whose login, name or a word of it starts with the query, as Jira's user picker."""
        query = query.lower()
        found = [
            login for login, name in self.data.PEOPLE.items()
            if not query or login.startswith(query) or any(word.lower().startswith(query) for word in name.split())
        ]
        return [self._user(login) for login in found]

    def attachment(
            self,
            attachment_id,
            name
    ):
        with self._lock:
            for issue in self.issues:
                for file in issue["attachments"]:
                    if file["id"] == attachment_id and file["filename"] == name:
                        return icons.attachment(self.data.DRAWINGS, name)
        return None

    def issue_json(
            self,
            issue,
            fields,
            expand
    ):
        """An issue as rest/api/2/issue returns it: only the fields asked for (all of them when none is
        named), and the expansions asked for."""
        everything = self._fields(issue)
        if fields:
            everything = {name: value for name, value in everything.items() if name in fields}
        result = {
            "id": issue["id"],
            "key": issue["key"],
            "self": f"{self.base}/rest/api/2/issue/{issue['id']}",
            "fields": everything,
        }
        if "renderedFields" in expand:
            result["renderedFields"] = {
                "description": render_wiki(issue["description"], self._attachment_urls(issue)),
                "comment": {
                    "comments": [{"id": c["id"], "body": render_wiki(c["body"], {})} for c in issue["comments"]],
                },
            }
        if "changelog" in expand:
            result["changelog"] = {
                "startAt": 0,
                "maxResults": len(issue["histories"]),
                "total": len(issue["histories"]),
                "histories": [
                    {
                        "id": history["id"],
                        "author": self._user(history["author"]),
                        "created": jira_date(history["created"]),
                        "items": history["items"],
                    }
                    for history in issue["histories"]
                ],
            }
        if "transitions" in expand:
            result["transitions"] = [
                {"id": id_, "name": name, "to": self._status(to)}
                for id_, name, to in self.data.WORKFLOW[issue["status"]]
            ]
        return result

    def _fields(self, issue):
        custom = self.data.FIELDS
        fields = {
            "summary": issue["summary"],
            "status": self._status(issue["status"]),
            "issuetype": self._type(issue["type"]),
            "priority": self._priority(issue["priority"]),
            "assignee": self._user(issue["assignee"]),
            "reporter": self._user(issue["reporter"]),
            "created": jira_date(issue["created"]),
            "updated": jira_date(issue["updated"]),
            "labels": list(issue["labels"]),
            "description": issue["description"],
            "comment": {
                "startAt": 0,
                "maxResults": len(issue["comments"]),
                "total": len(issue["comments"]),
                "comments": [
                    {
                        "id": c["id"],
                        "author": self._user(c["author"]),
                        "updateAuthor": self._user(c["author"]),
                        "body": c["body"],
                        "created": jira_date(c["created"]),
                        "updated": jira_date(c["created"]),
                    }
                    for c in issue["comments"]
                ],
            },
            "fixVersions": [{"id": "10400", "name": self.data.FIX_VERSION, "released": False}],
            "components": [
                {"name": self.data.COMPONENTS[label]}
                for label in issue["labels"]
                if label in self.data.COMPONENTS
            ],
            "issuelinks": [self._link(*link) for link in issue["links"]],
            "subtasks": [],
            "attachment": [
                {
                    "id": file["id"],
                    "filename": file["filename"],
                    "author": self._user(file["author"]),
                    "created": jira_date(file["created"]),
                    "size": len(icons.attachment(self.data.DRAWINGS, file["filename"])),
                    "mimeType": "image/svg+xml",
                    "content": url,
                    "thumbnail": url,
                }
                for file, url in zip(issue["attachments"], self._attachment_urls(issue).values())
            ],
            "resolution": issue["resolution"] and {"id": "10000", "name": issue["resolution"]},
            "resolutiondate": issue["resolutiondate"] and jira_date(issue["resolutiondate"]),
            "duedate": issue["duedate"],
            custom["storyPoints"]: issue["points"],
            custom["sprints"]: [self._sprint_string(sprint) for sprint in issue["sprints"]],
            custom["criticality"]: issue.get("criticality") and {"id": "10500", "value": issue["criticality"]},
            custom["developer"]: self._user(issue["developer"]),
            custom["tester"]: self._user(issue["tester"]),
            custom["environments"]: [{"value": name} for name in issue.get("environments", [])] or None,
        }
        for role in ("deliveredAt", "installedAt", "acceptedAt"):
            at = issue["dates"].get(role)
            fields[custom[role]] = at and jira_date(at)
        return fields

    def _board_issue(self, issue):
        assignee = issue["assignee"]
        type_name, type_file = self.data.TYPES[issue["type"]]
        priority_name, priority_file = self.data.PRIORITIES[issue["priority"]]
        entry = {
            "id": int(issue["id"]),
            "key": issue["key"],
            "hidden": False,
            "summary": issue["summary"],
            "typeId": issue["type"],
            "typeName": type_name,
            "typeUrl": self._icon_url(type_file),
            "priorityId": issue["priority"],
            "priorityName": priority_name,
            "priorityUrl": self._icon_url(priority_file),
            "statusId": issue["status"],
            "statusName": self._status_name(issue["status"]),
            "done": issue["status"] == self.data.DONE_STATUS,
            "estimateStatistic": {
                "statFieldId": self.data.FIELDS["storyPoints"],
                "statFieldValue": {} if issue["points"] is None else {"value": issue["points"]},
            },
        }
        if assignee:
            entry.update(
                assignee=assignee,
                assigneeName=self.data.PEOPLE[assignee],
                avatarUrl=self._avatar_url(assignee)
            )
        if issue["epic"]:
            entry["epicId"] = issue["epic"]["id"]
        return entry

    def _matches(
            self,
            issue,
            quick_filter
    ):
        query = next((f["query"] for f in self.data.QUICK_FILTERS if str(f["id"]) == str(quick_filter)), None)
        query = query or ""
        person = PERSON_FILTER.match(query)
        label = LABEL_FILTER.match(query)
        issue_type = TYPE_FILTER.match(query)
        if person:
            return issue["assignee"] == person.group(1)
        if label:
            return label.group(1) in issue["labels"]
        if issue_type:
            return self.data.TYPES[issue["type"]][0] == issue_type.group(1)
        return {
            "assignee = currentUser()": issue["assignee"] == self.data.ME,
            "assignee is EMPTY": issue["assignee"] is None,
        }.get(query, True)

    def _link(
            self,
            direction,
            name,
            other_key
    ):
        other = self._find(other_key)
        return {
            "id": f"{other['id']}{len(name)}",
            "type": LINK_TYPES[name],
            f"{direction}Issue": {
                "id": other["id"],
                "key": other["key"],
                "fields": {
                    "summary": other["summary"],
                    "status": self._status(other["status"]),
                    "priority": self._priority(other["priority"]),
                    "issuetype": self._type(other["type"]),
                },
            },
        }

    def _sprint_string(self, sprint_id):
        # Jira Server serialises the sprint field as a Java object's toString(), which the page parses.
        if sprint_id == self.data.SPRINT_ID:
            name, state, start, end = self.data.SPRINT_NAME, "ACTIVE", self.sprint_start, self.sprint_end
        else:
            length = timedelta(days=self.data.SPRINT_LENGTH_DAYS)
            name, state, start, end = self.data.PREVIOUS_SPRINT_NAME, "CLOSED", self.sprint_start - length, self.sprint_start
        return (
            f"com.atlassian.greenhopper.service.sprint.Sprint@{sprint_id:x}5e1f[id={sprint_id},"
            f"rapidViewId={self.data.BOARD_ID},state={state},name={name},startDate={start.isoformat()},"
            f"endDate={end.isoformat()},completeDate=<null>,sequence={sprint_id},goal=]"
        )

    def _attachment_urls(self, issue):
        return {
            file["filename"]: f"{self.base}/secure/attachment/{file['id']}/{file['filename']}"
            for file in issue["attachments"]
        }

    def _user(self, login):
        if login is None:
            return None
        name = self.data.PEOPLE.get(login) or (self.data.BOT[1] if login == self.data.BOT[0] else login)
        avatar = self._avatar_url(login)
        return {
            "self": f"{self.base}/rest/api/2/user?username={login}",
            "name": login,
            "key": login,
            "displayName": name,
            "emailAddress": f"{login}@{self.data.EMAIL_DOMAIN}",
            "active": True,
            "avatarUrls": {size: avatar for size in ("48x48", "24x24", "16x16", "32x32")},
        }

    def _avatar_url(self, login):
        # Jira's default avatar (no ownerId): the page draws the person's initials instead.
        logins = list(self.data.PEOPLE) + [self.data.BOT[0]]
        return f"{self.base}/secure/useravatar?avatarId={AVATAR_ID_BASE + logins.index(login)}"

    def _status(self, status_id):
        name, category = self.data.STATUSES[status_id]
        return {
            "self": f"{self.base}/rest/api/2/status/{status_id}",
            "id": status_id,
            "name": name,
            "statusCategory": {"key": category, "name": category.capitalize()},
        }

    def _type(self, type_id):
        name, file = self.data.TYPES[type_id]
        return {"id": type_id, "name": name, "subtask": False, "iconUrl": self._icon_url(file)}

    def _priority(self, priority_id):
        name, file = self.data.PRIORITIES[priority_id]
        return {"id": priority_id, "name": name, "iconUrl": self._icon_url(file)}

    def _status_name(self, status_id):
        return self.data.STATUSES[status_id][0] if status_id else None

    def _icon_url(self, file):
        return f"{self.base}/images/icons/demo/{file}"


def item(
        field,
        from_id,
        from_string,
        to_id,
        to_string
):
    return {
        "field": field,
        "fieldtype": "jira",
        "from": from_id,
        "fromString": from_string,
        "to": to_id,
        "toString": to_string,
    }


def jira_date(moment):
    return moment.strftime(JIRA_DATE)


def previous_working_day(moment):
    day = moment - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def working_days(
        start,
        end
):
    days, day = 0, start.date()
    while day < end.date():
        day += timedelta(days=1)
        if day.weekday() < 5:
            days += 1
    return days


def render_wiki(
        text,
        attachments
):
    """Jira's wiki markup to HTML, for the subset the scenarios use: headings, lists, tables, code blocks,
    embedded images, monospace, bold and italics."""
    out, list_tag, code = [], None, None
    for line in text.split("\n"):
        if code is not None:
            if line.strip() == "{code}":
                out.append(CODE_BLOCK.format(html.escape("\n".join(code), quote=False)))
                code = None
            else:
                code.append(line)
            continue
        tag = "ul" if line.startswith("* ") else "ol" if line.startswith("# ") else None
        tag = "table" if line.startswith("|") else tag
        if tag != list_tag:
            if list_tag:
                out.append(f"</{list_tag}>")
            if tag:
                out.append(f"<{tag}>")
            list_tag = tag
        if tag == "table":
            out.append(table_row(line))
        elif tag:
            out.append(f"<li>{inline(line[2:])}</li>")
        elif line.startswith("{code"):
            code = []
        elif line.startswith("h3. "):
            out.append(f"<h3>{inline(line[4:])}</h3>")
        elif line.startswith("!") and line.endswith("!") and line[1:-1] in attachments:
            out.append(f'<p><span class="image-wrap"><img src="{attachments[line[1:-1]]}" alt=""></span></p>')
        elif line.strip():
            out.append(f"<p>{inline(line)}</p>")
    if list_tag:
        out.append(f"</{list_tag}>")
    return "\n".join(out)


def table_row(line):
    """A table row: ||heading||heading|| or |cell|cell|."""
    cell = "th" if line.startswith("||") else "td"
    cells = line.strip("|").split("||" if cell == "th" else "|")
    return "<tr>" + "".join(f"<{cell}>{inline(text.strip())}</{cell}>" for text in cells) + "</tr>"


def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"\{\{(.+?)\}\}", r"<tt>\1</tt>", text)
    text = re.sub(r"(?<![\w*])\*(\S[^*]*?)\*(?![\w*])", r"<b>\1</b>", text)
    return re.sub(r"(?<!\w)_(\S[^_]*?)_(?!\w)", r"<em>\1</em>", text)
