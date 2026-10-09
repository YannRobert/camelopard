"""The demo's fake Jira, read by Jirafe's own client and local copy: when Jirafe reads something new from Jira,
these tests say whether the demo still serves it."""
import json
import random
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from jirafe.jira import JiraClient
from jirafe.meter import RequestMeter
from jirafe.mirror import IssueMirror, detail_fields
from jirafe.upstream import UpstreamPool
from jirafe.workflow import workflow_of

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1] / "demo")
)
import dataset  # noqa: E402
import fakejira  # noqa: E402

DAY_MS = 24 * 3600 * 1000


class DemoJiraTest(unittest.TestCase):

    def setUp(self):
        self.jira = fakejira.FakeJiraServer(0)
        self.jira.quiet = True
        # A short poll: shutdown() waits for it, at the end of every test.
        threading.Thread(
            target=self.jira.serve_forever,
            kwargs={"poll_interval": 0.05},
            daemon=True
        ).start()
        self.addCleanup(self.jira.server_close)
        self.addCleanup(self.jira.shutdown)
        self.upstream = UpstreamPool(RequestMeter())
        self.client = JiraClient(
            self.jira.base_url,
            "demo",
            self.upstream
        )
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.mirror = IssueMirror(
            directory.name,
            self.client,
            dataset.BOARD_ID,
            detail_fields(dataset.FIELDS)
        )

    def get(self, path):
        return self.client.get_json(
            path,
            "test"
        )

    def write(
            self,
            method,
            path,
            payload
    ):
        status, body, _ = self.upstream.request(
            method,
            f"{self.jira.base_url}/{path}",
            {"Authorization": "Bearer demo", "Content-Type": "application/json"},
            "test",
            json.dumps(payload).encode()
        )
        return status, json.loads(body) if body else None

    def board_keys(self):
        board = self.get(f"rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId={dataset.BOARD_ID}")
        return [issue["key"] for issue in board["issuesData"]["issues"]]

    def test_full_sync_copies_every_issue_with_its_history(self):
        self.assertEqual(self.mirror.sync_board(), len(dataset.ISSUES))
        entry = self.mirror.read("FOL-101")
        self.assertIn("changelog", entry["data"])
        self.assertIn("description", entry["data"]["renderedFields"])

    def test_history_feeds_the_activity_and_the_stand_up(self):
        self.mirror.sync_board()
        activity = self.mirror.activity(int(time.time() * 1000) - 3 * DAY_MS)
        kinds = {change["kind"] for issue in activity for change in issue["changes"]}
        self.assertEqual(kinds, {"status", "assignee", "comment"})

    def test_workflow_learned_from_the_issues_leads_from_to_do_to_done(self):
        self.mirror.sync_board()
        issue = self.get("rest/api/2/issue/FOL-101?fields=status,issuetype&expand=transitions")
        self.assertEqual(
            self.mirror.workflows.route(
                workflow_of(issue),
                "1",
                dataset.DONE_STATUS,
                issue["transitions"]
            ),
            list(dataset.MAIN_LINE[1:])
        )

    def test_incremental_sync_fetches_only_what_changed(self):
        self.mirror.sync_board()
        self.jira.board.comment(
            "FOL-103",
            "bruno",
            "Looking into it."
        )
        self.assertEqual(self.mirror.sync_board(refresh_sprints=False), 1)

    def test_board_quick_filter_asked_to_jira(self):
        board = self.get("rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId=1&activeQuickFilters=3")
        types = {issue["typeName"] for issue in board["issuesData"]["issues"]}
        self.assertEqual(types, {"Bug"})

    def test_labels_page_and_people(self):
        page = self.get(f"rest/agile/1.0/board/1/sprint/{dataset.SPRINT_ID}/issue?fields=labels&maxResults=50&startAt=0")
        self.assertEqual(page["total"], len(dataset.ISSUES))
        self.assertEqual(set(page["issues"][0]["fields"]), {"labels"})
        self.assertEqual(self.get("rest/api/2/myself")["name"], dataset.ME)
        found = self.get("rest/api/2/user/assignable/search?issueKey=FOL-101&username=okaf")
        self.assertEqual([user["name"] for user in found], ["grace"])

    def test_transition_applies_only_from_the_current_status(self):
        self.assertEqual(self.write("POST", "rest/api/2/issue/FOL-101/transitions", {"transition": {"id": "71"}})[0], 400)
        self.assertEqual(self.write("POST", "rest/api/2/issue/FOL-101/transitions", {"transition": {"id": "11"}})[0], 204)
        issue = self.get("rest/api/2/issue/FOL-101?expand=changelog")
        self.assertEqual(issue["fields"]["status"]["name"], "In Progress")
        self.assertEqual(issue["changelog"]["histories"][-1]["author"]["name"], dataset.ME)

    def test_rank_and_assignee(self):
        keys = self.board_keys()
        self.assertEqual(self.write("PUT", "rest/agile/1.0/issue/rank", {"issues": [keys[2]], "rankBeforeIssue": keys[0]})[0], 204)
        self.assertEqual(self.board_keys()[:3], [keys[2], keys[0], keys[1]])
        status, body = self.write("PUT", "rest/api/2/issue/FOL-101/assignee", {"name": "nobody"})
        self.assertEqual(status, 400)
        self.assertIn("assignee", body["errors"])
        self.assertEqual(self.write("PUT", "rest/api/2/issue/FOL-101/assignee", {"name": "emma"})[0], 204)
        self.assertEqual(self.get("rest/api/2/issue/FOL-101?fields=assignee")["fields"]["assignee"]["name"], "emma")

    def test_simulated_colleagues_never_act_as_the_viewer(self):
        rng = random.Random(1)
        for _ in range(40):
            self.jira.board.simulate(rng)
        authors = {
            history["author"]
            for issue in self.jira.board.issues
            for history in issue["histories"]
            if history["created"].timestamp() > time.time() - 60
        }
        self.assertTrue(authors)
        self.assertNotIn(dataset.ME, authors)
