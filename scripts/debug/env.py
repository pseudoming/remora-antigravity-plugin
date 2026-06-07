import os
import sys

_scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)


def _human_size(size_bytes):
    if size_bytes is None:
        return "N/A"
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(size_bytes) < 1024.0:
            return f"{size_bytes:.1f} {unit}" if unit != 'B' else f"{size_bytes} B"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} PB"


def _safe_count(conn, table):
    try:
        row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
        return row[0] if row else 0
    except Exception:
        return "N/A"


def main():
    print("=== Remora Environment ===")

    # ── LOG_DIR ──
    try:
        from core.logger import LOG_DIR
    except Exception:
        LOG_DIR = "/tmp/remora/log"
    print(f"LOG_DIR:       {LOG_DIR}")

    # ── LOG_LEVEL ──
    log_level = os.environ.get("REMORA_LOG_LEVEL", "INFO")
    print(f"LOG_LEVEL:     {log_level} (from REMORA_LOG_LEVEL env, default INFO)")

    # ── LOG_FILES ──
    try:
        import glob as _glob_mod
        log_files = _glob_mod.glob(os.path.join(LOG_DIR, "system*.log"))
        log_count = len(log_files)
        names = ", ".join(sorted(os.path.basename(f) for f in log_files))
        print(f"LOG_FILES:     {log_count} files ({names})")
    except Exception:
        print("LOG_FILES:     N/A")

    # ── PLUGIN_ROOT / DATA_DIR / DB_PATH ──
    try:
        from adapter.bridge.paths import find_plugin_root, get_data_dir, get_db_path
        plugin_root = find_plugin_root()
        data_dir = get_data_dir()
        db_path = get_db_path()
    except Exception:
        plugin_root = "N/A"
        data_dir = "N/A"
        db_path = "N/A"

    print(f"PLUGIN_ROOT:   {plugin_root}")
    print(f"DATA_DIR:      {data_dir}")
    print(f"DB_PATH:       {db_path}")

    # ── DB_SIZE ──
    try:
        if os.path.exists(db_path):
            size_bytes = os.path.getsize(db_path)
            print(f"DB_SIZE:       {_human_size(size_bytes)}")
        else:
            print("DB_SIZE:       N/A (file not found)")
    except Exception:
        print("DB_SIZE:       N/A")

    # ── DB_TABLES ──
    try:
        import sqlite3
        if os.path.exists(db_path):
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            try:
                rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
                skip_prefixes = ("sqlite_", "messages_fts_")
                table_names = [r[0] for r in rows if not r[0].startswith(skip_prefixes) and r[0] != "messages_fts"]
                has_fts = any(r[0] == "messages_fts" for r in rows)
                display = ", ".join(table_names)
                if has_fts:
                    display += ", ..."
                print(f"DB_TABLES:     {display}")
            finally:
                conn.close()
        else:
            print("DB_TABLES:     N/A (DB not found)")
    except Exception:
        print("DB_TABLES:     N/A")

    # ── INSTALLED ──
    try:
        flag_path = os.path.join(data_dir, ".runtime", "installed.flag")
        if os.path.exists(flag_path):
            print(f"INSTALLED:     Yes ({flag_path})")
        else:
            print("INSTALLED:     No")
    except Exception:
        print("INSTALLED:     N/A")

    # ── TABLE COUNTS ──
    try:
        if os.path.exists(db_path):
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            try:
                sc = _safe_count(conn, "session_state")
                tc = _safe_count(conn, "project_topics")
                dc = _safe_count(conn, "topic_decisions")
                fc = _safe_count(conn, "file_changes")
                mc = _safe_count(conn, "messages")
                print()
                print(f"SESSION_COUNT: {sc} (from session_state table)")
                print(f"TOPIC_COUNT:   {tc} (from project_topics)")
                print(f"DECISION_COUNT: {dc} (from topic_decisions)")
                print(f"FILE_CHANGE_COUNT: {fc} (from file_changes)")
                print(f"MESSAGE_COUNT: {mc} (from messages)")
            finally:
                conn.close()
        else:
            print()
            print("SESSION_COUNT: N/A (DB not found)")
            print("TOPIC_COUNT:   N/A (DB not found)")
            print("DECISION_COUNT: N/A (DB not found)")
            print("FILE_CHANGE_COUNT: N/A (DB not found)")
            print("MESSAGE_COUNT: N/A (DB not found)")
    except Exception:
        print()
        print("SESSION_COUNT: N/A")
        print("TOPIC_COUNT:   N/A")
        print("DECISION_COUNT: N/A")
        print("FILE_CHANGE_COUNT: N/A")
        print("MESSAGE_COUNT: N/A")


if __name__ == "__main__":
    main()
