"""The page, driven in a real browser against the demo's fake Jira.

They need Playwright and its Chromium, a development tool only (see CONTRIBUTING.md): without it they are
skipped, so `python -m unittest` keeps running on the standard library alone. CI installs it and sets
CAMELOPARD_E2E, which turns a missing Playwright into a failure instead of a skip.
"""
