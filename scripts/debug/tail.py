#!/usr/bin/env python3
"""CLI tool to inspect the Remora unified log at /tmp/remora/log/system.log (and archives)."""

import argparse
import glob
import os
import re
import sys

LOG_DIR = "/tmp/remora/log"
BASE_LOG = os.path.join(LOG_DIR, "system.log")
ARCHIVE_GLOB = os.path.join(LOG_DIR, "system.*.log")

COLORS = {
    "ERROR": "\033[31m",
    "WARN": "\033[33m",
    "INFO": "\033[37m",
    "DEBUG": "\033[2m",
}
RESET = "\033[0m"

LINE_RE = re.compile(
    r"\[TID:([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)"
)


def parse_line(line: str) -> dict | None:
    m = LINE_RE.match(line.strip())
    if not m:
        return None
    return {
        "tid": m.group(1).strip(),
        "timestamp": m.group(2).strip(),
        "level": m.group(3).strip(),
        "source": m.group(4).strip(),
        "message": m.group(5).strip(),
        "raw": line.rstrip("\n"),
    }


def get_log_files(today_only: bool = False) -> list[str]:
    """system.log → archives date DESC."""
    files = []
    if os.path.isfile(BASE_LOG):
        files.append(BASE_LOG)
    if not today_only:
        archives = sorted(glob.glob(ARCHIVE_GLOB), reverse=True)
        files.extend(a for a in archives if a != BASE_LOG)
    return files


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect Remora unified log files"
    )
    parser.add_argument(
        "--level",
        type=str.upper,
        choices=["ERROR", "WARN", "INFO", "DEBUG"],
        default=None,
        help="Filter by log level",
    )
    parser.add_argument(
        "--grep",
        type=str,
        default=None,
        help="Case-insensitive substring match on the entire log line",
    )
    parser.add_argument(
        "--lines",
        type=int,
        default=20,
        help="Number of lines to show (default: 20)",
    )
    parser.add_argument(
        "--asc",
        action="store_true",
        help="Show in ascending chronological order (oldest first)",
    )
    parser.add_argument(
        "--today",
        action="store_true",
        help="Only show today's log (skip archive files)",
    )
    args = parser.parse_args()

    log_files = get_log_files(today_only=args.today)
    if not log_files:
        print("No log files found.", file=sys.stderr)
        sys.exit(1)

    matched = []
    for fp in log_files:
        try:
            with open(fp, "r") as fh:
                for raw in fh:
                    parsed = parse_line(raw)
                    if parsed is None:
                        continue
                    if args.level and parsed["level"] != args.level:
                        continue
                    if args.grep and args.grep.lower() not in raw.lower():
                        continue
                    matched.append((fp, parsed))
        except OSError as exc:
            print(f"[WARN] Cannot read {fp}: {exc}", file=sys.stderr)

    if not matched:
        sys.exit(0)

    matched.sort(key=lambda item: item[1]["timestamp"])

    matched = matched[-args.lines :]

    if not args.asc:
        matched = list(reversed(matched))

    for _fp, entry in matched:
        level = entry["level"]
        color = COLORS.get(level, "")
        ts = entry["timestamp"]
        src = entry["source"]
        msg = entry["message"]
        tid = entry["tid"]
        text = f"[TID:{tid}] [{ts}] [{level}] [{src}] {msg}"
        if color:
            print(f"{color}{text}{RESET}")
        else:
            print(text)


if __name__ == "__main__":
    main()
