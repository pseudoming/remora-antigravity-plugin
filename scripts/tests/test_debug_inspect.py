import os
import sys
import json
import sqlite3
import pytest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import adapter.bridge.paths as paths_module

SCHEMA = """
CREATE TABLE IF NOT EXISTS project_topics (
    uuid TEXT,
    topic_id TEXT,
    status TEXT DEFAULT 'open',
    summary TEXT,
    source TEXT DEFAULT 'auto',
    associated_files TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(uuid, topic_id)
);
CREATE TABLE IF NOT EXISTS topic_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_uuid TEXT,
    topic_id TEXT,
    conversation_id TEXT,
    decision TEXT,
    rationale TEXT,
    evidence_msg_ids TEXT,
    user_confirmed INTEGER DEFAULT 0,
    decision_type TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS session_state (
    session_id TEXT PRIMARY KEY,
    mode TEXT DEFAULT 'standard',
    is_cold_start INTEGER DEFAULT 1,
    updated_at DATETIME
);
CREATE TABLE IF NOT EXISTS watermarks (
    conversation_id TEXT PRIMARY KEY,
    project_uuid TEXT,
    last_msg_id INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_uuid TEXT,
    conversation_id TEXT,
    file_name TEXT,
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, file_name)
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    topic_id TEXT,
    role TEXT,
    content TEXT,
    line_number INTEGER,
    timestamp DATETIME
);
"""


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "remora_memory.db")
    monkeypatch.setattr(paths_module, "get_db_path", lambda: db_path)
    monkeypatch.setattr(paths_module, "get_data_dir", lambda: str(tmp_path))
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.close()
    return db_path


def _run(argv, capsys):
    import debug.inspect
    with patch("sys.argv", argv):
        debug.inspect.main()
    return capsys.readouterr()


class TestTopics:
    def test_lists_topics(self, temp_db, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO project_topics (uuid, topic_id, status, summary) "
                "VALUES ('uuid-1', 'topic-a', 'open', 'Add auth module')"
            )
            conn.execute(
                "INSERT INTO project_topics (uuid, topic_id, status, summary) "
                "VALUES ('uuid-1', 'topic-b', 'closed', 'Refactor db layer')"
            )
            conn.commit()

        captured = _run(["inspect.py", "--topics"], capsys)
        out = captured.out

        assert "UUID" in out and "TOPIC_ID" in out and "STATUS" in out
        assert "uuid-1" in out
        assert "topic-a" in out
        assert "open" in out
        assert "Add auth module" in out
        assert "topic-b" in out
        assert "closed" in out
        assert "Refactor db layer" in out

    def test_no_topics(self, temp_db, capsys):
        captured = _run(["inspect.py", "--topics"], capsys)
        assert "No project_topics found" in captured.out


class TestDecisions:
    def test_decisions_with_project(self, temp_db, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, decision, rationale, user_confirmed) "
                "VALUES ('p1', 't1', 'Use sqlite', 'It is embedded', 1)"
            )
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, decision, rationale, user_confirmed) "
                "VALUES ('p1', 't1', 'Use jsonl for logs', 'Human readable', 1)"
            )
            conn.commit()

        captured = _run(["inspect.py", "--decisions", "t1", "--project", "p1"], capsys)
        data = json.loads(captured.out)

        assert data["project_uuid"] == "p1"
        assert data["topic_id"] == "t1"
        assert len(data["decisions"]) == 2
        texts = [d["text"] for d in data["decisions"]]
        assert any("Use sqlite" in t for t in texts)
        assert any("Use jsonl for logs" in t for t in texts)

    def test_decisions_with_evidence(self, temp_db, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO messages (id, conversation_id, content) "
                "VALUES (1, 'c1', 'Evidence text here')"
            )
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, decision, rationale, "
                "user_confirmed, evidence_msg_ids) "
                "VALUES ('p1', 't1', 'Structured logging', 'Better debugging', 1, '[1]')"
            )
            conn.commit()

        captured = _run(["inspect.py", "--decisions", "t1", "--project", "p1"], capsys)
        data = json.loads(captured.out)
        assert data["decisions"][0]["evidence"] == "Evidence text here"

    def test_decisions_none_found(self, temp_db, capsys):
        captured = _run(["inspect.py", "--decisions", "nonexistent", "--project", "p1"], capsys)
        assert "No confirmed decisions" in captured.out

    def test_decisions_missing_project(self, temp_db, capsys):
        if "ANTIGRAVITY_PROJECT_ID" in os.environ:
            del os.environ["ANTIGRAVITY_PROJECT_ID"]
        with pytest.raises(SystemExit) as excinfo:
            _run(["inspect.py", "--decisions", "t1"], capsys)
        assert excinfo.value.code == 1
        captured = capsys.readouterr()
        assert "ANTIGRAVITY_PROJECT_ID" in captured.err


class TestSessions:
    def test_lists_sessions(self, temp_db, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO session_state (session_id, mode, is_cold_start, updated_at) "
                "VALUES ('sess-aaa', 'relax', 0, '2025-06-07 10:00:00')"
            )
            conn.execute(
                "INSERT INTO session_state (session_id, mode, is_cold_start, updated_at) "
                "VALUES ('sess-bbb', 'standard', 1, '2025-06-07 09:00:00')"
            )
            conn.commit()

        captured = _run(["inspect.py", "--sessions"], capsys)
        out = captured.out

        assert "SESSION_ID" in out and "MODE" in out and "COLD_START" in out
        assert "sess-aaa" in out
        assert "relax" in out
        assert "sess-bbb" in out
        assert "standard" in out

    def test_no_sessions(self, temp_db, capsys):
        captured = _run(["inspect.py", "--sessions"], capsys)
        assert "No sessions found" in captured.out


class TestLiveness:
    def test_liveness_with_retry_files(self, temp_db, tmp_path, monkeypatch, capsys):
        retries_dir = tmp_path / ".runtime" / "remora_subagent_retries"
        retries_dir.mkdir(parents=True)

        (retries_dir / "sub_1.json").write_text(
            json.dumps([{"entry": 1}, {"entry": 2}, {"entry": 3}])
        )
        (retries_dir / "sub_2.json").write_text(
            json.dumps({"key1": "a", "key2": "b"})
        )

        monkeypatch.setattr(paths_module, "get_data_dir", lambda: str(tmp_path))

        captured = _run(["inspect.py", "--liveness"], capsys)
        out = captured.out

        assert "Retry files (2)" in out
        assert "sub_1.json: 3 entries" in out
        assert "sub_2.json: 2 keys" in out

    def test_liveness_no_directory(self, temp_db, monkeypatch, capsys):
        monkeypatch.setattr(paths_module, "get_data_dir", lambda: "/nonexistent/path")
        captured = _run(["inspect.py", "--liveness"], capsys)
        assert "No retries directory" in captured.out

    def test_liveness_empty_directory(self, temp_db, tmp_path, monkeypatch, capsys):
        retries_dir = tmp_path / ".runtime" / "remora_subagent_retries"
        retries_dir.mkdir(parents=True)
        monkeypatch.setattr(paths_module, "get_data_dir", lambda: str(tmp_path))

        captured = _run(["inspect.py", "--liveness"], capsys)
        assert "No subagent retry files found" in captured.out

    def test_liveness_non_json_file(self, temp_db, tmp_path, monkeypatch, capsys):
        retries_dir = tmp_path / ".runtime" / "remora_subagent_retries"
        retries_dir.mkdir(parents=True)
        (retries_dir / "bad.json").write_text("not valid json {{{")
        monkeypatch.setattr(paths_module, "get_data_dir", lambda: str(tmp_path))

        captured = _run(["inspect.py", "--liveness"], capsys)
        assert "Retry files (1)" in captured.out
        assert "error reading" in captured.out


class TestSql:
    def test_select_one(self, temp_db, capsys):
        captured = _run(["inspect.py", "--sql", "SELECT 1"], capsys)
        assert "1" in captured.out

    def test_select_multiple_columns(self, temp_db, capsys):
        captured = _run(["inspect.py", "--sql", "SELECT 2 AS a, 3 AS b"], capsys)
        assert "a | b" in captured.out
        assert "2" in captured.out
        assert "3" in captured.out

    def test_select_no_rows(self, temp_db, capsys):
        captured = _run(["inspect.py", "--sql", "SELECT * FROM project_topics WHERE 1=0"], capsys)
        assert "(no rows)" in captured.out


class TestFile:
    def test_file_decisions_link(self, temp_db, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO file_changes (project_uuid, conversation_id, file_name, source) "
                "VALUES ('p1', 'c1', 'auth.py', 'snapshot')"
            )
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, "
                "decision, rationale) "
                "VALUES ('p1', 't1', 'c1', 'Add rate limiting', 'Prevent abuse')"
            )
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, "
                "decision, rationale) "
                "VALUES ('p1', 't2', 'c1', 'Use bcrypt', 'Industry standard')"
            )
            conn.commit()

        captured = _run(["inspect.py", "--file", "auth.py", "--project", "p1"], capsys)
        data = json.loads(captured.out)

        assert data["project_uuid"] == "p1"
        assert data["file"] == "auth.py"
        assert len(data["decisions"]) == 2
        decision_texts = [d["decision"] for d in data["decisions"]]
        assert "Add rate limiting" in decision_texts
        assert "Use bcrypt" in decision_texts

    def test_file_none_found(self, temp_db, capsys):
        captured = _run(["inspect.py", "--file", "nonexistent.py", "--project", "p1"], capsys)
        assert "No decisions found for file" in captured.out


class TestEmptyDatabase:
    def test_topics_empty(self, temp_db, capsys):
        _run(["inspect.py", "--topics"], capsys)

    def test_sessions_empty(self, temp_db, capsys):
        _run(["inspect.py", "--sessions"], capsys)

    def test_decisions_empty(self, temp_db, capsys):
        _run(["inspect.py", "--decisions", "t", "--project", "p1"], capsys)

    def test_file_empty(self, temp_db, capsys):
        _run(["inspect.py", "--file", "f.py", "--project", "p1"], capsys)

    def test_sql_empty(self, temp_db, capsys):
        _run(["inspect.py", "--sql", "SELECT 1"], capsys)


class TestProjectEnv:
    def test_env_var_fallback(self, temp_db, monkeypatch, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, decision, rationale, user_confirmed) "
                "VALUES ('env-p1', 't1', 'Env decision', 'From env', 1)"
            )
            conn.commit()

        monkeypatch.setenv("ANTIGRAVITY_PROJECT_ID", "env-p1")

        captured = _run(["inspect.py", "--decisions", "t1"], capsys)
        data = json.loads(captured.out)

        assert data["project_uuid"] == "env-p1"
        assert data["topic_id"] == "t1"
        assert len(data["decisions"]) == 1

    def test_project_flag_overrides_env(self, temp_db, monkeypatch, capsys):
        with sqlite3.connect(temp_db) as conn:
            conn.execute(
                "INSERT INTO topic_decisions (project_uuid, topic_id, decision, rationale, user_confirmed) "
                "VALUES ('flag-p1', 't1', 'Flag decision', 'From flag', 1)"
            )
            conn.commit()

        monkeypatch.setenv("ANTIGRAVITY_PROJECT_ID", "env-p1")
        captured = _run(["inspect.py", "--decisions", "t1", "--project", "flag-p1"], capsys)
        data = json.loads(captured.out)
        assert data["project_uuid"] == "flag-p1"
