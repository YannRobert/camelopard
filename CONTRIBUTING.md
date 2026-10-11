# Contributing to Camelopard

Thanks for your interest! Issues and pull requests are welcome.

## Before starting

- For a significant change, open an issue first to discuss it.
- Read [AGENTS.md](AGENTS.md): it lists the project's non-negotiable constraints (standard library only,
  Windows / Linux / macOS portability, saving JIRA requests, security rules) and its conventions. They
  apply to humans as much as to coding agents.

## Running in development

```bash
export JIRA_PAT="the-token"
cd src && python3 -m camelopard --port 9101
```

Without access to a Jira, `python3 demo/run.py` runs Camelopard against a fake one (see `demo/`), with the
same page and server. `--scenario supplier` serves a heavy board instead (300 issues, 16 columns, 24
people, 42 quick filters, long specifications and comment threads): check a page change there too, so it
holds up on crowded boards without getting in the way on simple ones.

The page's files (`src/camelopard/static/`) are re-read on every request: a change shows up on the next
reload, without restarting the server.

## Checking

From the repository root, with nothing to install:

```bash
python3 -m compileall -q src tests demo
python3 -m unittest
```

With Node installed, the page's pure logic is tested too: `cd tests/js && node --test`.

The tests never call JIRA. Those of the page (`tests/e2e`) run in a real browser and are skipped unless
the development tools are installed, as CI does on every pull request:

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
python3 -m unittest tests.e2e.test_board
```

A pull request is merged once CI passes on Linux, macOS and Windows and in the browser. For a change to
the page or to the sync, also check the board, the detail panel and the `GET /stats` counter by hand.

## Pull requests

- One pull request per topic, with a description of the why. Its title ends up in the release notes:
  make it meaningful to a user.
- Never include a token, an internal instance URL or real issue data (screenshots included): take
  screenshots on the demo board.

By contributing, you agree that your contribution is published under the project's
[MIT license](LICENSE), and you commit to following the [code of conduct](CODE_OF_CONDUCT.md).
