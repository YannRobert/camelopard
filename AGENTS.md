# AGENTS.md

Instructions for a coding agent working on this repository. How the tool works is described in `README.md`; this
file lists what must be respected when changing it.

## Non-negotiable constraints

- **Standard library only**, in Python as in the page: no `pip install`, no framework, no CDN, no build
  step. The tool must start with a double-click on a machine without administrator rights. This binds
  the tool, not its development: the tools that check it (`requirements-dev.txt`) are installed by CI
  and by contributors who want them, never needed to run it, and the plain checks below still run
  without them.
- **Portable across Windows / Linux / macOS.** Every file is read and written as **explicit UTF-8**
  (`encoding="utf-8"`): the Windows default is cp1252. File replacements in the local copy must tolerate
  Windows' `PermissionError` (see `REPLACE_ATTEMPTS`).
- **`open.cmd` stays CRLF, `open.sh` stays LF** (enforced by `.gitattributes`): `cmd.exe`
  misreads an LF `.cmd`, and `sh` rejects a CRLF script. Both launchers do the same thing: changing one
  means changing the other.
- **Nothing specific to a JIRA instance in the repository** (host, board, `customfield_*`, project or
  column names): that belongs in the configuration (`config.py`, roles in `FIELD_ROLES`, `views`), since
  the repository is public.
- **Saving JIRA requests** is the reason the tool exists. Any new read goes through the local copy or an
  existing call; check the effect with `GET /stats`.

## Security — to preserve with every change

- Listen on `127.0.0.1` only; `host_allowed()` on every route.
- The `/jira/` relay only accepts `RELAYED_PREFIXES`. Only add a path the page reads, and never a prefix
  that would allow a write.
- No JIRA write other than `PUT /rank`, `PUT /assignee` and `PUT /transition`, which require
  `same_origin()` and build the body sent to JIRA themselves (`write_jira()`,
  `send_to_jira()`). A new write follows the same pattern: body built
  server-side from validated inputs, never a body relayed as is.
- The PAT must never reach the page (neither in the injected configuration nor in any response).

## Layout

- `src/camelopard/`: the package, run with `python -m camelopard` from `src/` (the launchers do it). No
  `pyproject.toml`: nothing gets installed. One module per responsibility (see README, "Layout");
  relative imports between modules.
- `src/camelopard/static/`: the page, as the browser loads it, with no build step. `index.html` is its
  structure; the public configuration (`jiraWeb`, `boardId`, `fields`, `views`) is injected in place of the
  `__CONFIG__` marker. `page.css` its look, `page.mjs` its behaviour, `logic.mjs` the pure logic (no DOM,
  no state, no request) the page imports and `tests/js` tests. A new file there is added to `PAGE_FILES`,
  the only names served under `/static/`.
- An extra custom field is added as a **role**: in `FIELD_ROLES`, in the page (through
  `custom(f, "role")`), and in the README roles table.
- `demo/`: a fake Jira Server (`fakejira/`) serving a fictional board (one package per board in `scenarios/`,
  each with its `dataset.py` and its `config.json`), and `run.py`, which starts it with the tool pointed at
  it. It serves only what the tool reads and writes: a new Jira read or write is added there too, and
  `tests/test_demo.py` runs the tool's own client and local copy against it. The server knows nothing of a
  board: what differs between scenarios goes in their dataset. Their data stays invented, never copied from a
  real instance, even anonymised.
- The configuration and the local copy live **outside the repository**, at each system's usual location
  (`paths.py`); never write there from the repository nor version them.

## Language

Everything is in English: documentation, Python code, tests, launchers, the page's code and its user
interface. Write new code, comments, messages and interface text in English. Data coming from Jira (column
names, statuses, quick filters…) is never translated.

## Style

- Comments explain **why** (constraint, pitfall, trade-off), not what.
- Named constants in `constants.py` rather than hard-coded values.
- Calls and declarations with more than one argument: one argument per line, a line break after `(`,
  and the closing parenthesis on its own line.

## Checking a change

From the repository root:

```bash
python3 -m compileall -q src tests demo
python3 -m unittest
```

The tests (`tests/`, `unittest` only, no network) cover the configuration, the local copy and the
server's security checks: every new route or write adds its own.

The page is driven in a real browser by `tests/e2e`, against the demo's fake Jira: a change to what the
user sees or presses adds or updates a scenario there. They need Playwright, skipped without it:

```bash
python3 -m pip install -r requirements-dev.txt && python3 -m playwright install chromium
python3 -m unittest tests.e2e.test_board
```

The pure logic of the page is tested with Node's built-in runner, nothing to install beyond Node: a
function that needs neither the DOM nor the page's state goes to `logic.mjs`, with its tests.

```bash
node --test tests/js/
```

CI also measures how much of the server the tests run (`coverage`, same file) and fails under 80 %: a new
route or branch comes with the tests that run it.

Also run the page (`python3 demo/run.py`) and check the board, the detail panel and the `/stats` counter
by eye: the scenarios cover the main paths, not the look.
