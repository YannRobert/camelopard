"""Jirafe on a fictional board, without a Jira: starts a fake Jira, then Jirafe pointed at it.

    python3 demo/run.py                 # opens the demo board in the browser
    python3 demo/run.py --jira-only     # only the fake Jira, for a Jirafe started by hand

The board, its team and its history are invented (dataset.py) and placed relative to the moment the demo
starts. Colleagues keep changing issues while it runs (--activity), so that the live refresh, the
notifications and "since your last visit" have something to show. Nothing is kept: every start begins
afresh, and the local copy of issues goes to a temporary directory, away from a real Jirafe's.
"""
import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import fakejira

DEMO_DIR = Path(__file__).resolve().parent
SRC_DIR = DEMO_DIR.parent / "src"
CONFIG_FILE = DEMO_DIR / "config.json"
# Another port than Jirafe's default (8766): the page keeps its data per origin, so a real board saved in
# the browser never shows up in a screenshot of the demo, and both can run side by side.
DEFAULT_PORT = 8767
DEFAULT_JIRA_PORT = 8768
DEFAULT_ACTIVITY_S = 90
# The fake Jira accepts any token; Jirafe only refuses to start without one.
DEMO_TOKEN = "demo"


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(
            encoding="utf-8",
            errors="replace"
        )
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Jirafe's port (default: %(default)s)")
    parser.add_argument("--jira-port", type=int, default=DEFAULT_JIRA_PORT, help="fake Jira's port (default: %(default)s)")
    parser.add_argument("--activity", type=int, default=DEFAULT_ACTIVITY_S, help="average seconds between two changes by colleagues, 0 for none (default: %(default)s)")
    parser.add_argument("--jira-only", action="store_true", help="only start the fake Jira")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    parser.add_argument("--quiet", action="store_true", help="do not log every request")
    args = parser.parse_args()

    try:
        jira = fakejira.start(
            args.jira_port,
            args.activity,
            args.quiet
        )
    except OSError as error:
        sys.exit(f"Port {args.jira_port} unavailable for the fake Jira ({error.strerror}): try --jira-port.")
    print(f"Demo Jira: {jira.base_url}", flush=True)
    if args.jira_only:
        print(f"Jirafe: JIRA_PAT={DEMO_TOKEN} python3 -m jirafe --config {CONFIG_FILE} --jira-host {jira.base_url}")
        wait_forever()
        return
    mirror_dir = tempfile.mkdtemp(prefix="jirafe-demo-")
    command = [
        sys.executable, "-m", "jirafe",
        "--config", str(CONFIG_FILE),
        "--jira-host", jira.base_url,
        "--port", str(args.port),
        "--mirror-dir", mirror_dir,
    ]
    command += [] if args.no_open else ["--open"]
    command += ["--quiet"] if args.quiet else []
    jirafe = subprocess.Popen(
        command,
        cwd=str(SRC_DIR),
        env={**os.environ, "JIRA_PAT": DEMO_TOKEN}
    )
    # Stopped by kill rather than Ctrl+C: Jirafe would otherwise outlive the fake Jira it reads.
    signal.signal(
        signal.SIGTERM,
        lambda *_: sys.exit(0)
    )
    try:
        jirafe.wait()
    except KeyboardInterrupt:
        # Ctrl+C reaches Jirafe too, from the same console: it only has to be waited for.
        jirafe.wait()
    finally:
        if jirafe.poll() is None:
            jirafe.terminate()
            jirafe.wait()
        shutil.rmtree(
            mirror_dir,
            ignore_errors=True
        )


def wait_forever():
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
