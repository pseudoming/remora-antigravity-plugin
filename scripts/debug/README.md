# Remora Debug Tools

Three lightweight CLI utilities for inspecting Remora's runtime state, logs, and database.

## 1. env.py — System Status

```
python3 scripts/debug/env.py
```

Displays configuration, database statistics, and subsystem counts. No arguments.

Output: plugin root, paths, DB size, table names, session/topic/decision/message counts.

## 2. tail.py — Log Viewer

```
python3 scripts/debug/tail.py [--level LEVEL] [--grep PATTERN] [--lines N] [--asc] [--today]
```

Inspect `/tmp/remora/log/system.log` and archived logs.

| Flag | Description |
|------|-------------|
| `--level ERROR` | Filter by log level (DEBUG/INFO/WARN/ERROR) |
| `--grep "h_abc12344"` | Filter by trace ID or any substring |
| `--lines 50` | Show last N lines (default 20) |
| `--asc` | Display in chronological order (default: newest first) |
| `--today` | Only today's log, skip archived files |

Examples:
```
python3 scripts/debug/tail.py                           # latest 20 entries
python3 scripts/debug/tail.py --level ERROR             # only errors
python3 scripts/debug/tail.py --grep "h_a1b2c3d4"       # a single hook invocation
python3 scripts/debug/tail.py --level WARN --lines 50   # last 50 warnings
```

## 3. inspect.py — Database Inspector

```
python3 scripts/debug/inspect.py --topics                  # list all topics
python3 scripts/debug/inspect.py --decisions t_001         # decisions for a topic
python3 scripts/debug/inspect.py --file auth.py            # file change history
python3 scripts/debug/inspect.py --sessions                # recent sessions
python3 scripts/debug/inspect.py --liveness                # subagent status
python3 scripts/debug/inspect.py --sql "SELECT ..."        # run arbitrary read-only SQL
```

| Flag | Description |
|------|-------------|
| `--topics` | List all project_topics with status and summary |
| `--decisions TOPIC` | Show confirmed decisions for a topic |
| `--file FILE` | Show decisions related to a filename |
| `--sessions` | Last 20 sessions from session_state |
| `--liveness` | Subagent retry counts |
| `--sql SQL` | Execute read-only SQL query |
| `--project UUID` | Specify project UUID (optional, uses env var otherwise) |

All read-only. No data is modified.

## Workflow

1. **Health check**: `python3 scripts/debug/env.py`
2. **Error investigation**: `python3 scripts/debug/tail.py --level ERROR --lines 50`
3. **Trace a request**: `python3 scripts/debug/tail.py --grep "TID:h_abc12344"`
4. **Inspect data**: `python3 scripts/debug/inspect.py --topics`
