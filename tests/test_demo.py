"""The demo's fake Jira, read by Camelopard's own client and local copy: when Camelopard reads something new from Jira,
these tests say whether the demo still serves it."""
import json
import random
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from camelopard.jira import JiraClient
from camelopard.meter import RequestMeter
from camelopard.mirror import IssueMirror, detail_fields
from camelopard.upstream import UpstreamPool
from camelopard.workflow import workflow_of

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1] / "demo")
)
import run  # noqa: E402
from fakejira import server as fakejira  # noqa: E402
from fakejira.board import Board  # noqa: E402

dataset = run.load(run.DEFAULT_SCENARIO)

DAY_MS = 24 * 3600 * 1000


class DemoJiraTest(unittest.TestCase):

    def setUp(self):
        self.jira = fakejira.FakeJiraServer(
            0,
            dataset
        )
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
        bruno = next(f["id"] for f in dataset.QUICK_FILTERS if f["name"] == "Bruno")
        board = self.get(f"rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId=1&activeQuickFilters={bruno}")
        self.assertEqual({issue["assignee"] for issue in board["issuesData"]["issues"]}, {"bruno"})

    def test_planned_sprints_are_off_the_board_but_in_the_agile_api(self):
        planned = self.get(f"rest/agile/1.0/board/{dataset.BOARD_ID}/sprint?state=future")["values"]
        self.assertEqual([sprint["id"] for sprint in planned], [sprint for sprint, _ in dataset.FUTURE_SPRINTS])
        self.assertNotIn("startDate", planned[1])
        board = set(self.board_keys())
        page = self.get(f"rest/agile/1.0/board/1/sprint/{planned[0]['id']}/issue?fields=epic,status&maxResults=50&startAt=0")
        keys = {issue["key"] for issue in page["issues"]}
        self.assertTrue(keys)
        self.assertFalse(keys & board)
        self.assertTrue(any(issue["fields"]["epic"] for issue in page["issues"]))
        bugs = self.get(f"rest/agile/1.0/board/1/sprint/{planned[0]['id']}/issue?fields=issuetype&jql=issuetype%20%3D%20Bug")
        self.assertEqual({issue["fields"]["issuetype"]["name"] for issue in bugs["issues"]}, {"Bug"})

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


class DemoScenariosTest(unittest.TestCase):
    """What every scenario must give Camelopard, whatever its board:
    the tests above only know the default one."""

    def serve(self, scenario):
        jira = fakejira.FakeJiraServer(
            0,
            scenario
        )
        jira.quiet = True
        threading.Thread(
            target=jira.serve_forever,
            kwargs={"poll_interval": 0.05},
            daemon=True
        ).start()
        self.addCleanup(jira.server_close)
        self.addCleanup(jira.shutdown)
        client = JiraClient(
            jira.base_url,
            "demo",
            UpstreamPool(RequestMeter())
        )
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        mirror = IssueMirror(
            directory.name,
            client,
            scenario.BOARD_ID,
            detail_fields(scenario.FIELDS)
        )
        return jira, client, mirror

    def test_every_scenario_syncs_and_walks_its_workflow(self):
        for name in run.scenarios():
            with self.subTest(name):
                scenario = run.load(name)
                jira, client, mirror = self.serve(scenario)
                self.assertEqual(mirror.sync_board(), len(scenario.ISSUES))
                first = next(issue["key"] for issue in jira.board.issues if issue["status"] == scenario.MAIN_LINE[0])
                issue = client.get_json(
                    f"rest/api/2/issue/{first}?fields=status,issuetype&expand=transitions",
                    "test"
                )
                self.assertEqual(
                    mirror.workflows.route(
                        workflow_of(issue),
                        scenario.MAIN_LINE[0],
                        scenario.DONE_STATUS,
                        issue["transitions"]
                    ),
                    list(scenario.MAIN_LINE[1:])
                )

    def test_every_quick_filter_is_understood(self):
        for name in run.scenarios():
            scenario = run.load(name)
            board = Board(
                "http://jira.test",
                scenario
            )
            for quick_filter in scenario.QUICK_FILTERS:
                with self.subTest(name, filter=quick_filter["name"]):
                    shown = board.all_data(str(quick_filter["id"]))["issuesData"]["issues"]
                    # A query the fake Jira does not understand lets every issue through.
                    self.assertLess(len(shown), len(scenario.ISSUES))

    def test_colleagues_never_act_as_the_viewer(self):
        for name in run.scenarios():
            with self.subTest(name):
                scenario = run.load(name)
                board = Board(
                    "http://jira.test",
                    scenario
                )
                rng = random.Random(1)
                for _ in range(60):
                    board.simulate(rng)
                authors = {
                    history["author"]
                    for issue in board.issues
                    for history in issue["histories"]
                    if history["created"].timestamp() > time.time() - 60
                }
                self.assertTrue(authors)
                self.assertNotIn(scenario.ME, authors)


class DemoContentTest(unittest.TestCase):

    def test_same_content_whatever_the_start_time(self):
        """Screenshots taken on different days show the same issues, people and comments: only the dates
        move with the start of the demo."""

        def content(now):
            return [
                (
                    issue["key"],
                    issue["status"],
                    issue["assignee"],
                    issue["reporter"],
                    [(comment["author"], comment["body"]) for comment in issue["comments"]],
                    sorted((history["author"], history["items"][0]["toString"] or "") for history in issue["histories"]),
                )
                for issue in Board(
                    "http://jira.test",
                    dataset,
                    now
                ).issues
            ]

        morning = datetime.now().astimezone().replace(hour=9, minute=30)
        for later in (timedelta(hours=10), timedelta(days=1, hours=5), timedelta(days=4)):
            self.assertEqual(content(morning), content(morning + later))
