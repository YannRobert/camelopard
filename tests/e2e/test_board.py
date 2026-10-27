import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(
    0,
    str(ROOT / "demo")
)
import run  # noqa: E402
from fakejira import server as fakejira  # noqa: E402

SCENARIO = run.DEFAULT_SCENARIO
dataset = run.load(SCENARIO)
STARTUP_TIMEOUT_S = 30
# Long enough for a board refresh through the local server, short enough for a broken page to fail fast.
WAIT_MS = 10000
REQUIRED = bool(os.environ.get("CAMELOPARD_E2E"))


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@unittest.skipUnless(
    sync_playwright or REQUIRED,
    "Playwright is not installed (development tool, see CONTRIBUTING.md)"
)
class BoardTest(unittest.TestCase):
    """What a user does on the board, key by key, as the browser sees it."""

    @classmethod
    def setUpClass(cls):
        # No colleagues at work (activity 0): the board stays as the dataset sets it for the whole run.
        cls.jira = fakejira.start(
            0,
            dataset,
            0,
            True
        )
        # Someone who acts on the sprint without any issue assigned, before the local copy is first filled:
        # Jira's automation account.
        cls.automated = next(issue["key"] for issue in cls.jira.board.issues if dataset.SPRINT_ID in issue["sprints"])
        cls.jira.board.comment(
            cls.automated,
            dataset.BOT[0],
            "Linked to the release automatically."
        )
        cls.mirror = tempfile.TemporaryDirectory()
        port = free_port()
        cls.url = f"http://127.0.0.1:{port}/"
        cls.server = subprocess.Popen(
            [
                sys.executable, "-m", "camelopard",
                "--config", str(run.SCENARIOS_DIR / SCENARIO / "config.json"),
                "--jira-host", cls.jira.base_url,
                "--port", str(port),
                "--mirror-dir", cls.mirror.name,
                "--quiet",
            ],
            cwd=ROOT / "src",
            env={**os.environ, "JIRA_PAT": run.DEMO_TOKEN},
        )
        cls.wait_for_server()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def wait_for_server(cls):
        deadline = time.monotonic() + STARTUP_TIMEOUT_S
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(cls.url, timeout=1):
                    return
            except OSError:
                time.sleep(0.2)
        cls.tearDownClass()
        raise RuntimeError(f"Camelopard did not answer on {cls.url}")

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "browser", None):
            cls.browser.close()
            cls.playwright.stop()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.jira.shutdown()
        cls.jira.server_close()
        cls.mirror.cleanup()

    def setUp(self):
        # A fresh context per test: nothing remembered from the previous one (theme, last visit, filters).
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(self.context.close)
        # Opening Jira is recorded rather than done: there is no Jira behind the demo's links.
        self.context.add_init_script("window.opened = []; window.open = url => { window.opened.push(url); };")
        self.page = self.context.new_page()
        self.page.set_default_timeout(WAIT_MS)
        # A script error or a file the security policy blocks fails the test, even where the scenario
        # would not notice.
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", lambda message: message.type == "error" and self.errors.append(message.text))
        self.addCleanup(lambda: self.assertEqual(self.errors, []))
        self.page.goto(self.url)
        self.page.locator("#board .card[data-key]").first.wait_for()

    def cards(self):
        return self.page.locator("#board .card[data-key]")

    def selected_key(self):
        return self.page.evaluate("document.querySelector('.card.selected')?.dataset.key ?? null")

    def focused(self):
        return self.page.evaluate("document.activeElement.id || document.activeElement.className")

    def test_board_shows_the_sprint_columns_and_cards(self):
        self.assertGreater(self.page.locator("#board .column").count(), 1)
        # Each column heading counts its cards: together, every card shown.
        counted = self.page.locator("#board .column h2 .n").evaluate_all("els => els.map(e => parseInt(e.textContent))")
        self.assertEqual(sum(counted), self.cards().count())
        self.assertGreater(self.cards().count(), 0)
        sprint = self.page.locator("#sprint-name").inner_text()
        expect(self.page).to_have_title(f"{sprint} · Camelopard")

    def test_typing_on_the_board_searches_and_escape_steps_back(self):
        everything = self.cards().count()
        self.page.keyboard.type("gift")
        expect(self.page.locator("#q")).to_have_value("gift")
        expect(self.page.locator("#q")).to_be_focused()
        self.assertLess(self.cards().count(), everything)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#q")).not_to_be_focused()
        expect(self.page.locator("#q")).to_have_value("gift")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#q")).to_have_value("")
        expect(self.cards()).to_have_count(everything)

    def test_the_users_own_filter_shows_once(self):
        me = self.page.locator(".qf.me")
        expect(me).to_have_count(1)
        expect(me).to_have_text(dataset.PEOPLE[dataset.ME].split()[0])
        expect(self.page.get_by_role("button", name="Only my issues")).to_have_count(0)
        self.page.locator("#people-filter").click()
        names = self.page.locator("#people-menu li .name").all_inner_texts()
        self.assertNotIn(dataset.PEOPLE[dataset.ME].split()[0], names)
        self.page.keyboard.press("Escape")
        me.click()
        expect(me).to_have_attribute("aria-pressed", "true")
        avatars = self.page.locator("#board .card[data-key] .avatar").evaluate_all("els => els.map(e => e.title)")
        self.assertTrue(avatars)
        self.assertTrue(all(dataset.PEOPLE[dataset.ME] in title for title in avatars))
        self.page.locator("#people-filter").click()
        expect(self.page.locator("#people-menu li.everyone")).to_have_attribute("aria-selected", "false")

    def test_the_filters_panel_narrows_by_status_and_reporter(self):
        total = self.cards().count()
        self.page.locator("#criteria-toggle").click()
        status = self.page.locator('#criteria-panel input[data-criterion="status"]').first
        status.check()
        narrowed = self.cards().count()
        self.assertLess(narrowed, total)
        expect(self.page.locator("#criteria-count")).to_have_text("1")
        self.assertIn("st=", self.page.url)
        # A reporter adds a criterion: never more cards than with the status alone.
        self.page.locator('#criteria-panel input[data-criterion="reporter"]').first.check()
        self.assertLessEqual(self.cards().count(), narrowed)
        # Clearing one criterion keeps the others.
        self.page.locator('#criteria-panel [data-criterion-clear="reporter"]').click()
        expect(self.cards()).to_have_count(narrowed)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#criteria-panel")).to_be_hidden()
        self.page.locator("#clear-filters").click()
        expect(self.cards()).to_have_count(total)
        expect(self.page.locator("#criteria-count")).to_have_text("")

    def test_a_planned_sprint_opens_from_the_sprint_list(self):
        sprint_id, name = dataset.FUTURE_SPRINTS[0]
        planned = [issue["key"] for issue in self.jira.board.issues if sprint_id in issue["sprints"]]
        self.page.locator("#sprint-toggle").click()
        expect(self.page.locator("#sprint-panel h4")).to_have_text(["Active", "Planned"])
        self.page.locator(f'#sprint-panel [data-sprint="{sprint_id}"]').click()
        expect(self.page.locator("#sprint-panel")).to_be_hidden()
        expect(self.page.locator("#sprint-name")).to_have_text(name)
        expect(self.page.locator("#remaining")).to_contain_text("Planned")
        expect(self.cards()).to_have_count(len(planned))
        self.assertIn(f"sprint={sprint_id}", self.page.url)
        # Reloaded, the address opens it again.
        self.page.reload()
        expect(self.page.locator("#sprint-name")).to_have_text(name)
        expect(self.cards()).to_have_count(len(planned))

    def test_a_sprint_started_since_the_settings_were_read_loads(self):
        # Settings saved while the active sprint was still planned, and no copy of its board: what a tab
        # left open holds once the next sprint has started.
        self.page.evaluate(
            """sprint => {
              const key = Object.keys(localStorage).find(k => /^sprint-board\\.\\d+$/.test(k));
              const saved = JSON.parse(localStorage.getItem(key));
              saved.meta.planned.push({ id: sprint, name: "Started since", planned: true });
              saved.boards = {};
              localStorage.setItem(key, JSON.stringify(saved));
            }""",
            dataset.SPRINT_ID
        )
        self.page.reload()
        self.page.locator("#board .card[data-key]").first.wait_for()
        expect(self.page.locator("#remaining")).not_to_contain_text("Planned")

    def test_people_menu_adds_who_the_board_has_no_filter_on(self):
        self.page.locator("#people-filter").click()
        newcomer = self.page.locator("#people-menu li.apart")
        # After the board's own filters, set apart: the only one listed there.
        expect(newcomer.locator(".name")).to_have_text(dataset.PEOPLE[dataset.NEWCOMER].split()[0])
        expect(newcomer).to_have_attribute(
            "title",
            re.compile(f"^{dataset.PEOPLE[dataset.NEWCOMER]}:")
        )
        expect(self.page.locator("#people-menu li.apart ~ li")).to_have_count(0)
        newcomer.click()
        expect(self.page.locator("#people-filter")).to_contain_text(dataset.PEOPLE[dataset.NEWCOMER].split()[0])
        self.assertIn(
            f"qf=%40{dataset.NEWCOMER}",
            self.page.url
        )
        avatars = self.page.locator("#board .card[data-key] .avatar").evaluate_all("els => els.map(e => e.title)")
        self.assertTrue(avatars)
        self.assertTrue(all(dataset.PEOPLE[dataset.NEWCOMER] in title for title in avatars))

    def test_people_list_keeps_its_photos_while_the_highlight_moves(self):
        self.page.locator("#people-filter").click()
        options = self.page.locator("#people-menu li")
        # A mark on the elements themselves: rebuilt, the list would lose it with the photos it reloads.
        options.evaluate_all("els => els.forEach(el => { el.kept = true; })")
        options.nth(2).hover()
        expect(options.nth(2)).to_have_class(re.compile(r"\bactive\b"))
        self.page.keyboard.press("ArrowDown")
        expect(options.nth(3)).to_have_class(re.compile(r"\bactive\b"))
        expect(self.page.locator("#people-menu li.active")).to_have_count(1)
        self.assertTrue(options.evaluate_all("els => els.every(el => el.kept)"))

    def test_a_photo_that_does_not_load_leaves_the_initials(self):
        self.page.evaluate(
            """() => document.body.insertAdjacentHTML(
              "beforeend",
              '<span class="avatar" id="broken-photo">AB<img src="/static/no-such-photo.png" alt=""></span>'
            )"""
        )
        expect(self.page.locator("#broken-photo img")).to_have_count(0)
        expect(self.page.locator("#broken-photo")).to_have_text("AB")
        # The browser reports the missing photo itself: the one error this test expects.
        self.assertEqual(len(self.errors), 1)
        self.assertIn("404", self.errors.pop())

    def test_arrows_change_issue_from_a_card_and_scroll_in_the_detail(self):
        self.cards().first.click()
        expect(self.page.locator("#panel")).to_be_visible()
        first = self.selected_key()
        self.page.keyboard.press("d")
        self.assertIn(self.focused(), ("panel-content", "body"))
        self.page.keyboard.press("ArrowDown")
        self.assertEqual(self.selected_key(), first)
        self.page.keyboard.press("Escape")
        self.assertIn("card", self.focused())
        self.page.keyboard.press("ArrowDown")
        expect(self.page.locator(".card.selected")).not_to_have_attribute("data-key", first)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#panel")).to_be_hidden()
        self.assertIn("card", self.focused())

    def test_the_detail_says_how_fresh_its_copy_is_and_keeps_counting(self):
        self.cards().first.click()
        age = self.page.locator("#panel-sync .sync-age")
        expect(age).to_have_text(re.compile(r"^(< 5 s|\d+ s) ago$"))
        # A copy checked 20 s earlier: the next tick, within 5 s, says so without a reload.
        age.evaluate("element => { element.dataset.at = String(Date.now() - 20000); }")
        expect(age).to_have_text(re.compile(r"^2[05] s ago$"), timeout=WAIT_MS)

    def test_enter_opens_the_detail_and_j_opens_jira(self):
        self.cards().first.click()
        key = self.selected_key()
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#panel")).to_be_hidden()
        self.page.keyboard.press("Enter")
        expect(self.page.locator("#panel")).to_be_visible()
        self.assertEqual(self.selected_key(), key)
        self.page.keyboard.press("Enter")
        expect(self.page.locator("#panel")).to_be_visible()
        self.page.keyboard.press("j")
        self.assertEqual(self.page.evaluate("window.opened"), [f"{dataset_web()}/browse/{key}"])

    def test_comments_and_history_mix_in_time_order_and_stay_so(self):
        # An issue of the sprint with both, so that the stream mixes something.
        key = next(
            issue["key"] for issue in self.jira.board.issues
            if dataset.SPRINT_ID in issue["sprints"] and issue["comments"] and issue["histories"]
        )
        self.page.locator(f'#board .card[data-key="{key}"]').click()
        comments = self.page.locator('#panel-content h4[data-jump="comments"]')
        expect(comments).to_contain_text("Comments")
        self.page.locator('#panel-content h4[data-jump="history"] .timeline-toggle').wait_for()
        comments.locator(".timeline-toggle").click()
        expect(comments).to_contain_text("Comments and history")
        expect(comments.locator(".timeline-toggle")).to_have_attribute("aria-checked", "true")
        timeline = self.page.locator("#panel-content .timeline")
        expect(timeline.locator(".comment").first).to_be_visible()
        expect(timeline.locator(".history").first).to_be_visible()
        # Every comment and every change, once each (their order is logic.mjs's, tested there).
        counts = self.page.locator('#panel-content :is([data-jump="comments"], [data-jump="history"])').evaluate_all(
            "els => els.reduce((sum, el) => sum + Number(el.dataset.count), 0)"
        )
        expect(timeline.locator(":scope > *")).to_have_count(counts)
        # The table of contents still reaches both, each with its count.
        expect(self.page.locator('#panel-sections [data-target="history"]')).to_be_visible()
        # Reloaded, the page opens the issue again (its key is in the address), still in time order.
        self.page.reload()
        expect(comments).to_contain_text("Comments and history")
        comments.locator(".timeline-toggle").click()
        expect(self.page.locator("#panel-content .timeline")).to_have_count(0)
        expect(self.page.locator('#panel-content h4[data-jump="history"]')).to_contain_text("History")

    def test_the_activity_list_shows_others_mine_or_all(self):
        key = next(issue["key"] for issue in self.jira.board.issues if dataset.SPRINT_ID in issue["sprints"])
        self.jira.board.comment(
            key,
            dataset.ME,
            "Answered on the call."
        )
        # Resynced from its panel: the background sync would take a minute.
        self.page.locator(f'#board .card[data-key="{key}"]').click()
        self.page.locator("#panel-sync .resync").click()
        expect(self.page.locator("#panel-content")).to_contain_text("Answered on the call.")
        # The local copy may be written just after the panel shows it. Polled from here: wait_for_function
        # takes the promise fetch returns as truthy and does not wait for it.
        deadline = time.monotonic() + WAIT_MS / 1000
        while "Answered on the call." not in self.page.evaluate("fetch('/activity?since=0').then(r => r.text())"):
            self.assertLess(
                time.monotonic(),
                deadline
            )
            time.sleep(0.2)
        # Jira dates have no milliseconds: a comment within the second the page opened would fall before
        # the visit. A minute back, and a reload reads the list at once rather than on the next poll.
        self.page.evaluate("localStorage.setItem('sprint-board.visitSince', String(Date.now() - 60000))")
        self.page.reload()
        self.page.locator("#activity-btn").click()
        panel = self.page.locator("#activity-panel")
        expect(panel.locator("h4")).to_contain_text("Changed by others")
        expect(panel).not_to_contain_text("Answered on the call.")
        panel.locator('[data-scope="mine"]').click()
        expect(panel.locator("h4")).to_contain_text("Changed by me")
        expect(panel).to_contain_text("Answered on the call.")
        authors = set(panel.locator(".activity-list ul .who").all_inner_texts())
        self.assertEqual(authors, {dataset.PEOPLE[dataset.ME]})
        panel.locator('[data-scope="all"]').click()
        expect(panel).to_contain_text("Answered on the call.")
        self.assertGreater(len(set(panel.locator(".activity-list ul .who").all_inner_texts())), 1)
        # The bell counts others' changes only, whatever the list shows.
        self.assertNotIn("by me", self.page.locator("#activity-btn").get_attribute("title"))
        self.page.reload()
        self.page.locator("#activity-btn").click()
        expect(self.page.locator('#activity-panel [data-scope="all"]')).to_have_attribute("aria-pressed", "true")

    def test_a_link_to_an_issue_opens_it_here_unless_asked_for_jira(self):
        key, other = [issue["key"] for issue in self.jira.board.issues if dataset.SPRINT_ID in issue["sprints"]][:2]
        self.jira.board.comment(
            key,
            dataset.ME,
            f"Same cause as {other}."
        )
        self.page.locator(f'#board .card[data-key="{key}"]').click()
        self.page.locator("#panel-sync .resync").click()
        link = self.page.locator(f'#panel-content a[href$="/browse/{other}"]').first
        expect(link).to_have_attribute("title", re.compile("Ctrl"))
        # Ctrl + click: Jira, in a tab of its own, the panel left as it was.
        with self.context.expect_page() as jira_tab:
            link.click(modifiers=["ControlOrMeta"])
        self.assertIn(f"/browse/{other}", jira_tab.value.url)
        jira_tab.value.close()
        expect(self.page.locator("#panel-key")).to_have_text(key)
        link.click()
        expect(self.page.locator("#panel-key")).to_have_text(other)
        self.assertEqual(self.page.evaluate("window.opened"), [])
        self.assertEqual(len(self.context.pages), 1)
        # The address names the open issue: reloaded or shared, it opens it again.
        self.assertIn(f"issue={other}", self.page.url)
        self.page.reload()
        expect(self.page.locator("#panel-key")).to_have_text(other)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#panel")).to_be_hidden()
        self.assertNotIn("issue=", self.page.url)

    def test_assigning_from_the_detail_writes_to_jira(self):
        card = self.page.locator("#board .card[data-key]:has(.avatar.none)").first
        key = card.get_attribute("data-key")
        card.click()
        self.page.keyboard.press("Shift+A")
        expect(self.page.locator("#assignee-query")).to_be_focused()
        self.page.keyboard.type("bruno")
        self.page.keyboard.press("Enter")
        expect(self.page.locator(f'#board .card[data-key="{key}"] .avatar')).to_have_attribute("title", "Bruno Costa")
        self.assertEqual(
            self.jira.board.issue(key, "assignee", "")["fields"]["assignee"]["name"],
            "bruno"
        )

    def test_the_detail_says_who_last_set_the_status_and_the_assignee(self):
        card = self.page.locator("#board .card[data-key]:has(.avatar.none)").first
        card.click()
        # A status always has its aside: who set it, or that it is the one the issue was created with.
        expect(self.page.locator("#panel .status-pill + .changed-by")).to_have_count(1)
        self.page.keyboard.press("Shift+A")
        self.page.keyboard.type("bruno")
        self.page.keyboard.press("Enter")
        expect(self.page.locator("#panel .assign + .changed-by")).to_contain_text(" ago")

    def test_shift_s_starts_the_stand_up_and_escape_ends_it(self):
        self.page.keyboard.press("Shift+S")
        expect(self.page.locator("#standup-query")).to_be_focused()
        expect(self.page.locator("#standup-query")).to_have_value("")
        self.page.keyboard.press("Escape")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#standup")).to_be_hidden()

    def test_the_stand_up_gives_the_floor_to_whoever_acted_without_any_issue(self):
        self.page.keyboard.press("Shift+S")
        bot = self.page.locator(f'#standup-people button[title^="{dataset.BOT[1]}"]')
        # An automation account, as configured: set apart from the people, and never next in the round.
        expect(self.page.locator(f'#standup-people .sep ~ button[title^="{dataset.BOT[1]}"]')).to_have_count(1)
        self.page.keyboard.press("Enter")
        expect(bot).not_to_have_attribute(
            "aria-pressed",
            "true"
        )
        bot.click()
        expect(self.page.locator("#standup-changes")).to_contain_text("Linked to the release automatically.")
        # Commenting hands nothing over: the card is there for what they did on it.
        expect(self.page.locator(f'#board .card[data-key="{self.automated}"] .handed')).to_have_text("worked on")

    def test_the_stand_up_sets_the_unassigned_issues_apart(self):
        self.page.keyboard.press("Shift+S")
        unassigned = self.page.locator("#standup-people > .sep + button")
        expect(unassigned.locator(".label")).to_have_text("Unassigned issues")
        unassigned.click()
        expect(self.page.locator("#standup-changes h3")).to_have_text(re.compile(r"^Changes on unassigned issues since "))

    def test_question_mark_lists_the_keys_of_where_it_is_pressed(self):
        self.page.keyboard.press("?")
        expect(self.page.locator("#board-shortcuts-panel")).to_be_visible()
        self.page.keyboard.press("Escape")
        self.cards().first.click()
        self.page.keyboard.press("?")
        expect(self.page.locator("#shortcuts-panel")).to_be_visible()
        expect(self.page.locator("#board-shortcuts-panel")).to_be_hidden()


def dataset_web():
    return BoardTest.jira.base_url
