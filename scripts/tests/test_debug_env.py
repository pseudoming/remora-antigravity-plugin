import os
import sys
import sqlite3
import importlib.util
import pytest

_scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

spec = importlib.util.spec_from_file_location(
    "debug_env", os.path.join(_scripts_dir, "debug", "env.py")
)
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)


def _make_db(db_path, tables_with_rows):
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    for table, rows in tables_with_rows.items():
        if table == "session_state":
            cur.execute(
                "CREATE TABLE session_state (id TEXT PRIMARY KEY, data TEXT)"
            )
        elif table == "project_topics":
            cur.execute(
                "CREATE TABLE project_topics (id TEXT, title TEXT, status TEXT)"
            )
        elif table == "topic_decisions":
            cur.execute(
                "CREATE TABLE topic_decisions (id TEXT, topic_id TEXT, decision TEXT)"
            )
        elif table == "file_changes":
            cur.execute(
                "CREATE TABLE file_changes (id TEXT, path TEXT, action TEXT)"
            )
        elif table == "messages":
            cur.execute(
                "CREATE TABLE messages (id TEXT, role TEXT, content TEXT)"
            )
        elif table == "messages_fts":
            cur.execute("CREATE VIRTUAL TABLE messages_fts USING fts5(content)")
        else:
            cur.execute(f"CREATE TABLE {table} (id TEXT)")
        for row in rows:
            placeholders = ",".join("?" * len(row))
            cur.execute(f"INSERT INTO {table} VALUES ({placeholders})", row)
    conn.commit()
    conn.close()


def _make_empty_db(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.close()


def _make_log_files(log_dir, count):
    for i in range(count):
        (log_dir / f"system.{i}.log").write_text(f"log line {i}")


@pytest.fixture
def paths(monkeypatch, tmp_path):
    from adapter.bridge import paths as bridge_paths
    from core import logger
    import core.storage.connection as conn_module

    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "remora_memory.db"
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(bridge_paths, "find_plugin_root", lambda: str(tmp_path))
    monkeypatch.setattr(bridge_paths, "get_data_dir", lambda: str(data_dir))
    monkeypatch.setattr(conn_module, "get_db_path", lambda: str(db_path))
    monkeypatch.setattr(bridge_paths, "get_db_path", lambda: str(db_path))
    monkeypatch.setattr(logger, "LOG_DIR", str(log_dir))
    monkeypatch.setattr(sys.modules["core.logger"], "LOG_DIR", str(log_dir))

    return {
        "tmp_path": tmp_path,
        "data_dir": data_dir,
        "db_path": db_path,
        "log_dir": log_dir,
    }


class TestFullReport:
    def test_full_report(self, paths, capsys):
        tables = {
            "session_state": [
                ("s1", "{}"),
                ("s2", "{}"),
                ("s3", "{}"),
            ],
            "project_topics": [
                ("t1", "Topic A", "active"),
                ("t2", "Topic B", "done"),
                ("t3", "Topic C", "active"),
                ("t4", "Topic D", "done"),
                ("t5", "Topic E", "active"),
            ],
            "topic_decisions": [
                ("d1", "t1", "approved"),
                ("d2", "t2", "rejected"),
            ],
            "file_changes": [
                ("f1", "/src/a.py", "modify"),
                ("f2", "/src/b.py", "create"),
                ("f3", "/src/c.py", "delete"),
                ("f4", "/src/d.py", "modify"),
            ],
            "messages": [
                ("m1", "user", "hello"),
                ("m2", "assistant", "hi"),
                ("m3", "user", "help"),
                ("m4", "assistant", "sure"),
                ("m5", "user", "thanks"),
                ("m6", "assistant", "np"),
                ("m7", "user", "ok"),
                ("m8", "assistant", "cool"),
                ("m9", "user", "bye"),
                ("m10", "assistant", "bye"),
            ],
            "messages_fts": [
                ("hello",),
            ],
        }
        _make_db(paths["db_path"], tables)
        _make_log_files(paths["log_dir"], 2)
        runtime_dir = paths["data_dir"] / ".runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        (runtime_dir / "installed.flag").write_text("")

        env.main()
        out = capsys.readouterr().out

        assert "LOG_DIR:" in out
        assert "LOG_LEVEL:" in out
        assert "INFO" in out
        assert "LOG_FILES:" in out
        assert "2 files" in out
        assert "PLUGIN_ROOT:" in out
        assert "DATA_DIR:" in out
        assert "DB_PATH:" in out
        assert "DB_SIZE:" in out
        assert "DB_TABLES:" in out
        assert "file_changes" in out
        assert "messages" in out
        assert "session_state" in out
        assert "project_topics" in out
        assert "topic_decisions" in out
        assert "..."
        assert "INSTALLED:     Yes" in out
        assert "SESSION_COUNT: 3" in out
        assert "TOPIC_COUNT:   5" in out
        assert "DECISION_COUNT: 2" in out
        assert "FILE_CHANGE_COUNT: 4" in out
        assert "MESSAGE_COUNT: 10" in out


class TestEmptyDatabase:
    def test_empty_database_no_crash(self, paths, capsys):
        _make_empty_db(paths["db_path"])
        env.main()
        out = capsys.readouterr().out
        assert "DB_TABLES:" in out
        assert "SESSION_COUNT:" in out
        assert "TOPIC_COUNT:" in out
        assert "DECISION_COUNT:" in out
        assert "FILE_CHANGE_COUNT:" in out
        assert "MESSAGE_COUNT:" in out


class TestDBAbsent:
    def test_db_file_absent_no_crash(self, paths, capsys):
        env.main()
        out = capsys.readouterr().out
        assert "DB_SIZE:       N/A (file not found)" in out
        assert "DB_TABLES:     N/A (DB not found)" in out
        assert "SESSION_COUNT: N/A (DB not found)" in out
        assert "TOPIC_COUNT:   N/A (DB not found)" in out


class TestMultipleLogFiles:
    def test_multiple_log_files(self, paths, capsys):
        _make_log_files(paths["log_dir"], 3)
        env.main()
        out = capsys.readouterr().out
        assert "LOG_FILES:     3 files" in out
        assert "system.0.log" in out
        assert "system.1.log" in out
        assert "system.2.log" in out


class TestLogLevelDebug:
    def test_log_level_debug(self, paths, monkeypatch, capsys):
        monkeypatch.setenv("REMORA_LOG_LEVEL", "DEBUG")
        env.main()
        out = capsys.readouterr().out
        assert "LOG_LEVEL:     DEBUG" in out


class TestInstalledFlag:
    def test_installed_flag_present(self, paths, capsys):
        runtime_dir = paths["data_dir"] / ".runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        (runtime_dir / "installed.flag").write_text("")
        env.main()
        out = capsys.readouterr().out
        assert "INSTALLED:     Yes" in out

    def test_installed_flag_absent(self, paths, capsys):
        env.main()
        out = capsys.readouterr().out
        assert "INSTALLED:     No" in out
