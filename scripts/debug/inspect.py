#!/usr/bin/env python3
"""CLI tool to inspect remora_memory.db in read-only mode."""

import os
import sys
import json
import argparse
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib import dao
from core.storage.connection import _get_conn, closing
from adapter.bridge import paths


def _resolve_project_uuid(args):
    uuid = args.project or os.environ.get("ANTIGRAVITY_PROJECT_ID")
    if not uuid:
        print("Set ANTIGRAVITY_PROJECT_ID or use --project UUID", file=sys.stderr)
        return None
    return uuid


def _get_all_project_uuids():
    try:
        with closing(_get_conn()) as conn:
            with conn:
                rows = conn.execute("SELECT DISTINCT uuid FROM project_topics").fetchall()
                project_uuids = [r[0] for r in rows]
                if not project_uuids:
                    rows = conn.execute("SELECT DISTINCT project_uuid FROM watermarks").fetchall()
                    project_uuids = [r[0] for r in rows]
                return project_uuids
    except Exception as e:
        print(f"Error querying project uuids: {e}", file=sys.stderr)
        return []


def cmd_topics(args):
    uuids = _get_all_project_uuids()
    if not uuids:
        print("No project_topics found.")
        return

    lines = []
    lines.append(f"{'UUID':36}  {'TOPIC_ID':50}  {'STATUS':8}  SUMMARY")
    lines.append("-" * 120)
    for uuid in uuids:
        topics = dao.get_topics_by_uuid(uuid)
        for topic_id, status, summary in topics:
            summary_short = (summary or "")[:60]
            lines.append(f"{uuid:36}  {topic_id:50}  {status:8}  {summary_short}")
    print("\n".join(lines))


def cmd_decisions(args):
    uuid = _resolve_project_uuid(args)
    if not uuid:
        sys.exit(1)
    topic_id = args.decisions
    decisions = dao.get_confirmed_decisions(uuid, topic_id)
    if not decisions:
        print(f"No confirmed decisions for topic {topic_id}")
        return
    print(json.dumps({"project_uuid": uuid, "topic_id": topic_id, "decisions": decisions}, indent=2, ensure_ascii=False))


def cmd_file(args):
    uuid = _resolve_project_uuid(args)
    if not uuid:
        sys.exit(1)
    file_name = args.file
    rows = dao.get_decisions_by_file(uuid, file_name)
    if not rows:
        print(f"No decisions found for file: {file_name}")
        return
    print(json.dumps({"project_uuid": uuid, "file": file_name, "decisions": rows}, indent=2, ensure_ascii=False))


def cmd_sessions(args):
    try:
        with closing(_get_conn()) as conn:
            with conn:
                rows = conn.execute(
                    "SELECT session_id, mode, is_cold_start, updated_at FROM session_state ORDER BY updated_at DESC LIMIT 20"
                ).fetchall()
        if not rows:
            print("No sessions found.")
            return
        lines = []
        lines.append(f"{'SESSION_ID':40}  {'MODE':12}  {'COLD_START':10}  UPDATED_AT")
        lines.append("-" * 100)
        for sid, mode, cs, ua in rows:
            mode_str = mode or "standard"
            lines.append(f"{sid:40}  {mode_str:12}  {str(cs):10}  {ua}")
        print("\n".join(lines))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_liveness(args):
    data_dir = paths.get_data_dir()
    retries_dir = os.path.join(data_dir, ".runtime", "remora_subagent_retries")
    if not os.path.isdir(retries_dir):
        print(f"No retries directory: {retries_dir}")
        return
    json_files = sorted(f for f in os.listdir(retries_dir) if f.endswith(".json"))
    if not json_files:
        print("No subagent retry files found.")
        return
    print(f"Retry files ({len(json_files)}):")
    for fname in json_files:
        fpath = os.path.join(retries_dir, fname)
        try:
            with open(fpath, "r") as fh:
                data = json.load(fh)
            if isinstance(data, list):
                print(f"  {fname}: {len(data)} entries")
            elif isinstance(data, dict):
                print(f"  {fname}: {len(data)} keys")
            else:
                print(f"  {fname}: non-collection")
        except Exception as e:
            print(f"  {fname}: error reading ({e})")


def cmd_sql(args):
    db_path = paths.get_db_path()
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)
    uri = f"file:{db_path}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        with conn:
            cur = conn.execute(args.sql)
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description] if cur.description else []
            if not rows:
                print("(no rows)")
                return
            if cols:
                print(" | ".join(cols))
                print("-" * 80)
            for row in rows:
                print(json.dumps(list(row), ensure_ascii=False))
        conn.close()
    except Exception as e:
        print(f"SQL error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Inspect remora_memory.db (read-only)")
    parser.add_argument("--project", help="Project UUID (overrides ANTIGRAVITY_PROJECT_ID env)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--topics", action="store_true", help="List all project_topics with status/summary")
    group.add_argument("--decisions", metavar="TOPIC", help="List all confirmed decisions for a topic")
    group.add_argument("--file", metavar="FILE", help="Show file_changes / decisions history for a file")
    group.add_argument("--sessions", action="store_true", help="Show recent sessions from session_state")
    group.add_argument("--liveness", action="store_true", help="Show subagent retry counts")
    group.add_argument("--sql", metavar="SQL", help="Execute a raw SQL query (read-only)")
    args = parser.parse_args()

    if args.topics:
        cmd_topics(args)
    elif args.decisions:
        cmd_decisions(args)
    elif args.file:
        cmd_file(args)
    elif args.sessions:
        cmd_sessions(args)
    elif args.liveness:
        cmd_liveness(args)
    elif args.sql:
        cmd_sql(args)


if __name__ == "__main__":
    main()
